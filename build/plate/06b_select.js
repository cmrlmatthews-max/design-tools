/* ==========================================================================
   SELECT, EDIT and DRAW  (plan section 5 "Editing", 6 "Picking")
   Click a unit to select it (the card shows type, width, area, exposures, flags, a lock toggle and the type chips).
   Drag a bay line (the demising line between two units) to move it along the run: the two units change width, their sum stays, and both
   become locks. Drag the core, a stair or a support block to move it (snap to the grid). Draw: tap points for a polygon plate, or two
   corners for a block. Mac shortcuts: 1 to 6 views (Plan is 6 and the default), D Model/Diagram, L lock, F re-fill, Delete removes a block,
   Escape clears.

   Picking is plane math: a ray to the plane at the elevation of the editing level, then the plan point is tested against the unit
   rings. There are no picking meshes. A bay line is hit within BAY_PX screen pixels (16 on a mouse, 28 on touch).

   Rework (docs/plate-planner-rework-plan.md section 7.2): a bay drag stops at the width range of the two types (widthMin, widthMax), with both
   widths shown beside the line; Split and Merge on the unit card; a tap on an unfilled run (a "remainder") opens a card that fills it with
   locked units; Draw > Unit takes two taps on one run; a core drag sets the core to Manual; the card of the core resets it to Auto.
   Every edit is a Store write, so Undo and Redo work.

   Selection and the drawing in progress live HERE, never in the Store, so they are never saved, exported or undone. A lock is state:
   `locks` for a drawn plate, `levels.groups[gid].locks` for a project. Locked units keep their outline and type through every fill.
   ========================================================================== */
const Select = (() => {
  const $ = (id) => document.getElementById(id);
  const PICK_PX = 6, PICK_MS = 400, BAY_PX = 16, BAY_PX_TOUCH = 28;       // BAY_PX_TOUCH is a 56 px wide target; the touch dot is 24 px, the hit area more than 44 pt
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const D = () => Derived.get();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let sel = null, ready = false, draw = null, drag = null, hover = null;
  const listeners = [];
  let group = null, previewGroup = null, dotTexture = null;
  const fmt = (v) => Units.formatFeetInches(v);

  /* ---- levels, units, locks -------------------------------------------------------------------------------- */
  const editing = () => { const d = D(); return d.ok ? d.editing : null; };
  const unitAt = (k) => { const L = editing(); return L && L.units[k] ? L.units[k] : null; };
  const mixList = () => { const s = Store.raw(); return (s.mix && s.mix[s.mode]) || []; };
  const typeOf = (id) => mixList().find((t) => t.id === id) || null;
  const locksPath = () => {
    const s = Store.raw(), L = editing();
    if (s.source === 'project') return L && L.groupId ? `levels.groups.${L.groupId}.locks` : null;
    return 'locks';
  };
  const locksNow = () => { const p = locksPath(); const v = p ? Store.get(p) : null; return Array.isArray(v) ? v : []; };
  function writeLocks(next, live = false) {
    const p = locksPath();
    if (!p) return false;
    const s = Store.raw(), L = editing();
    if (s.source === 'project' && !(s.levels.groups && s.levels.groups[L.groupId])) Store.set(`levels.groups.${L.groupId}`, { filled: true, locks: next }, { live });
    else Store.set(p, next, { live });
    return true;
  }
  const nextLockId = (locks) => { let n = 1; while (locks.some((l) => l.id === `U-${String(n).padStart(2, '0')}`)) n++; return `U-${String(n).padStart(2, '0')}`; };
  const rnd3 = (v) => Math.round(v * 1000) / 1000;
  const cleanOuter = (ring) => ring.map((p) => [rnd3(p[0]), rnd3(p[1])]);
  const lockIndexOf = (locks, outer) => locks.findIndex((l) => sameRing(l.outer, outer));
  /** Puts a lock for `outer` with `type` (replaces the lock of the same outline or of `replaceOuter`). */
  function putLock(locks, outer, type, replaceOuter) {
    const next = locks.map((l) => ({ ...l, outer: l.outer.map((p) => [p[0], p[1]]) }));
    const i = lockIndexOf(next, replaceOuter || outer);
    if (i >= 0) next[i] = { ...next[i], outer: cleanOuter(outer), type };
    else next.push({ id: nextLockId(next), outer: cleanOuter(outer), type });
    return next;
  }

  /* ---- geometry of a unit ------------------------------------------------------------------------------------ */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const unitVec = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const extent = (ring, v) => { let lo = Infinity, hi = -Infinity; for (const p of ring) { const q = dot(p, v); if (q < lo) lo = q; if (q > hi) hi = q; } return [lo, hi]; };
  const edgeOnRing = (a, b, ring, tol = 0.05) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) return false;
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i], d = ring[(i + 1) % ring.length];
      const q = nearestOnSeg(a[0], a[1], c, d), r = nearestOnSeg(b[0], b[1], c, d);
      if (q.d < tol && r.d < tol) return true;
      const q2 = nearestOnSeg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, c, d);
      if (q2.d < tol && Math.abs(unitVec(a, b)[0] * unitVec(c, d)[1] - unitVec(a, b)[1] * unitVec(c, d)[0]) < 1e-3) return true;
    }
    return false;
  };
  /** The run frame of a unit: tangent t (along the run), normal n (into the unit), width w along t and depth d along n. */
  function frameOf(L, u) {
    const ring = u.outer, n = ring.length;
    const corRings = L.corridor.flatMap((p) => [p.outer, ...(p.holes || [])]);
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 2) continue;
      if (corRings.some((cr) => edgeOnRing(a, b, cr)) && (!best || len > best.len)) best = { len, t: unitVec(a, b) };
    }
    if (!best) {
      let far = null;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!far || len < far.len) far = { len, t: unitVec(a, b) };
      }
      best = far ? { len: far.len, t: [-far.t[1], far.t[0]] } : { len: 0, t: [1, 0] };
    }
    const t = best.t, nv = [-t[1], t[0]];
    const [t0, t1] = extent(ring, t), [n0, n1] = extent(ring, nv);
    return { t, n: nv, t0, t1, n0, n1, w: t1 - t0, d: n1 - n0 };
  }
  /** The width range a type allows in a run (rework plan 7.2): widthMin to widthMax, times the bays for a hotel key. */
  function widthRangeOf(t) {
    const hotel = Store.raw().mode === 'hotel', k = hotel ? Math.max(1, t.bays || 1) : 1;
    return [t.widthMin * k, t.widthMax * k];
  }
  /** { lo, hi } for a type id, or null. */
  function bayRange(typeId) {
    const t = typeOf(typeId);
    if (!t) return null;
    const [lo, hi] = widthRangeOf(t);
    return { lo, hi };
  }
  /** The usable width range of the unit's own type at its depth, or null. */
  function rangeFor(typeId, depth) {
    const s = Store.raw();
    try {
      const eff = MixMod.effectiveTypes(mixList(), depth, s.mode).types;
      return eff.find((t) => t.id === typeId) || null;
    } catch (e) { return null; }
  }

  /** The shared edges of the editing level: { a, b, p, q, t, mid } with a, b the unit indices and t the unit vector from a toward b. */
  let bayCache = null;
  function bayEdges() {
    const d = D(), L = d.ok ? d.editing : null;
    if (!L) return [];
    if (bayCache && bayCache.key === d.geomId) return bayCache.list;
    const list = [];
    const U = L.units;
    const boxes = U.map((u) => boxOfRings([u.outer]));
    for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) {
      if (!boxHit(growBox(boxes[i], 0.05), boxes[j])) continue;
      const A = U[i].outer, B = U[j].outer;
      for (let ia = 0; ia < A.length; ia++) {
        const a0 = A[ia], a1 = A[(ia + 1) % A.length], la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
        if (la < 1) continue;
        const ua = unitVec(a0, a1);
        for (let ib = 0; ib < B.length; ib++) {
          const b0 = B[ib], b1 = B[(ib + 1) % B.length];
          const ub = unitVec(b0, b1);
          if (Math.abs(ua[0] * ub[1] - ua[1] * ub[0]) > 1e-3 || dot(ua, ub) > 0) continue;       // opposite directions on a shared edge
          const off0 = (b0[0] - a0[0]) * ua[1] - (b0[1] - a0[1]) * ua[0], off1 = (b1[0] - a0[0]) * ua[1] - (b1[1] - a0[1]) * ua[0];
          if (Math.abs(off0) > 0.05 || Math.abs(off1) > 0.05) continue;
          const ta = [0, la], tb0 = dot([b0[0] - a0[0], b0[1] - a0[1]], ua), tb1 = dot([b1[0] - a0[0], b1[1] - a0[1]], ua);
          const lo = Math.max(ta[0], Math.min(tb0, tb1)), hi = Math.min(ta[1], Math.max(tb0, tb1));
          if (hi - lo < 1) continue;
          const p = [a0[0] + ua[0] * lo, a0[1] + ua[1] * lo], q = [a0[0] + ua[0] * hi, a0[1] + ua[1] * hi];
          const perp = [-ua[1], ua[0]];
          const ca = ringCentroidXY(A), cb = ringCentroidXY(B);
          let t = perp;
          if (dot([cb[0] - ca[0], cb[1] - ca[1]], t) < 0) t = [-t[0], -t[1]];
          list.push({ a: i, b: j, ia, ib, p, q, t, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] });
        }
      }
    }
    bayCache = { key: d.geomId, list };
    return list;
  }

  /** The units of an edge as they are now: { A, B, typeA, typeB } (outlines and type ids). */
  function baseOf(e) {
    const L = editing();
    return { A: L.units[e.a].outer, B: L.units[e.b].outer, typeA: L.units[e.a].type, typeB: L.units[e.b].type };
  }
  /** The widths of the two units for a shift d of the shared line toward b. → { ok, wa, wb, ra, rb, outerA, outerB } */
  function bayMove(e, delta, base = baseOf(e)) {
    const L = editing();
    const shift = (ring) => ring.map((pt) => {
      const onEdge = [e.p, e.q].some((v) => Math.hypot(pt[0] - v[0], pt[1] - v[1]) < 0.06);
      return onEdge ? [pt[0] + e.t[0] * delta, pt[1] + e.t[1] * delta] : [pt[0], pt[1]];
    });
    const outerA = shift(base.A), outerB = shift(base.B);
    const ra = bayRange(base.typeA), rb = bayRange(base.typeB);          // the width range of each type, not the area range (rework plan 7.2)
    const wA = Math.abs(extent(outerA, e.t)[1] - extent(outerA, e.t)[0]), wB = Math.abs(extent(outerB, e.t)[1] - extent(outerB, e.t)[0]);
    const eps = 0.001;
    const okA = !ra || (wA >= ra.lo - eps && wA <= ra.hi + eps), okB = !rb || (wB >= rb.lo - eps && wB <= rb.hi + eps);
    return { ok: okA && okB && wA > 0.5 && wB > 0.5, wa: wA, wb: wB, ra, rb, outerA, outerB };
  }
  /** The largest |shift| in each direction the two units allow (bisection on the move). */
  function bayLimits(e, base = baseOf(e)) {
    const probe = (sign) => {
      let lo = 0, hi = 12;
      if (bayMove(e, sign * hi, base).ok) return hi;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (bayMove(e, sign * mid, base).ok) lo = mid; else hi = mid; }
      return lo;
    };
    return { back: -probe(-1), fwd: probe(1) };
  }
  /**
   * Applies a bay move to the Store (locks the two units at their new outlines). Refused (false) when a width leaves its range.
   * During a drag `base` holds the outlines at the start and `prev` the outlines written last (the locks to replace).
   */
  function moveBay(e, delta, live = false, base = baseOf(e), prev = null) {
    const L = editing();
    if (!L || !e) return false;
    const m = bayMove(e, delta, base);
    if (!m.ok) return false;
    let locks = locksNow();
    locks = putLock(locks, m.outerA, base.typeA, prev ? prev.A : base.A);
    locks = putLock(locks, m.outerB, base.typeB, prev ? prev.B : base.B);
    if (prev) { prev.A = m.outerA; prev.B = m.outerB; }
    return writeLocks(locks, live);
  }

  /* ---- selection --------------------------------------------------------------------------------------------- */
  const sameSel = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;
  function setSel(next) {
    const n = next ? { ...next } : null;
    const changed = JSON.stringify(n) !== JSON.stringify(sel);
    sel = n;
    if (changed) onChanged();
    return changed;
  }
  const clear = () => setSel(null);
  function onChanged() {
    renderCard();
    refreshOverlay();
    listeners.forEach((fn) => { try { fn(sel ? { ...sel } : null); } catch (e) { console.error(e); } });
  }
  function blockRing(s0) {
    const L = editing();
    if (!L || !s0) return null;
    if (s0.kind === 'core') return L.core;
    if (s0.kind === 'stair') { const b = L.stairs.find((x) => x.id === s0.id); return b ? b.outer : null; }
    if (s0.kind === 'support' || s0.kind === 'remainder') { const b = L.support.find((x) => x.id === s0.id && (s0.kind === 'support' || x.kind === 'remainder')); return b ? b.outer : null; }
    return null;
  }
  function selRing() {
    if (!sel) return null;
    if (sel.kind === 'unit') { const u = unitAt(sel.k); return u ? u.outer : null; }
    return blockRing(sel);
  }
  function sanitize() {
    if (sel && !selRing()) { sel = null; onChanged(); return true; }
    return false;
  }

  /* ---- rays ---------------------------------------------------------------------------------------------------- */
  function canvasRect() { const c = Render.canvas(); return c ? c.getBoundingClientRect() : null; }
  function camera() { const c = Render.camera(); c.updateMatrixWorld(true); return c; }
  function setRay(cx, cy) {
    const rect = canvasRect(), cam = camera();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
  }
  /** The elevation the editing level is drawn at (the top of its slab). */
  function topZ() {
    const L = editing(), stack = !!Store.raw().view.levels3d || Plate3D.editingAtZ(Store.raw());
    if (!L) return 0;
    return (stack ? L.z : 0) + (stack ? Math.max(1, L.ftf - 1) : CONFIG.slabHeight) + 0.08;
  }
  /** The plan point under a screen point (client px): [x, y] on the plane of the editing level, or null. */
  function planAt(cx, cy) {
    if (!ready) return null;
    setRay(cx, cy);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topZ());
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, p) ? [p.x, -p.z] : null;
  }
  const toClient = (v3) => {
    const rect = canvasRect(), p = v3.clone().project(camera());
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, z: p.z };
  };
  const screenOf = (x, y, z) => { const p = toClient(new THREE.Vector3(...planToWorld(x, y, z == null ? topZ() : z))); return { x: p.x, y: p.y }; };
  function pxPerFt(x, y) {
    const z = topZ();
    const a = toClient(new THREE.Vector3(...planToWorld(x, y, z))), b = toClient(new THREE.Vector3(...planToWorld(x + 10, y, z))), c = toClient(new THREE.Vector3(...planToWorld(x, y + 10, z)));
    return Math.max(0.05, Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)) / 10);
  }
  /** Grid snap (view.snap), corners of other blocks and plate edges are not snapped: the grid is the one rule. Alt skips it. */
  function snapPoint(p, { skip = false } = {}) {
    const sn = Store.raw().view.snap;
    if (skip || !sn.on) return { x: p[0], y: p[1], kind: 'free' };
    const g = sn.grid || 0.5;
    return { x: Math.round(p[0] / g) * g, y: Math.round(p[1] / g) * g, kind: 'grid' };
  }
  const snapAt = (cx, cy, alt) => { const p = planAt(cx, cy); return p ? snapPoint(p, { skip: alt }) : null; };

  /* ---- finding what is under a point ------------------------------------------------------------------------------ */
  function pickAt(cx, cy) {
    if (!ready || Render.comparing()) return null;
    const p = planAt(cx, cy);
    const L = editing();
    if (!p || !L) return null;
    const x = p[0], y = p[1];
    for (const b of L.support) if (pointInRing(x, y, b.outer) && b.kind !== 'pocket' && b.kind !== 'remainder' && b.userBlock !== false && isUserSupport(b.id)) return { kind: 'support', id: b.id };
    const roomIds = new Set((L.coreRooms || []).map((r) => r.id));
    for (const s of L.stairs) if (!roomIds.has(s.id) && pointInRing(x, y, s.outer)) return { kind: 'stair', id: s.id };      // the stairs of an auto core are part of the core
    for (const e of L.elevators) if (pointInRing(x, y, e.outer)) return { kind: 'core', id: 'core' };
    if (L.core && pointInRing(x, y, L.core)) return { kind: 'core', id: 'core' };
    for (let k = 0; k < L.units.length; k++) if (pointInRing(x, y, L.units[k].outer)) return { kind: 'unit', id: String(k), k };
    for (const b of L.support) if (b.kind === 'remainder' && pointInRing(x, y, b.outer)) return { kind: 'remainder', id: b.id };       // an unfilled run is tappable
    for (const b of L.support) if (pointInRing(x, y, b.outer)) return { kind: 'support', id: b.id };
    return null;
  }
  const isUserSupport = (id) => (Store.raw().support || []).some((b) => b.id === id);

  /* ---- overlay: selection outline, bay handles, drawing preview ---------------------------------------------------- */
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
  const ringPos = (ring, z, closed = true) => {
    const out = [], n = ring.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) out.push(...planToWorld(ring[i][0], ring[i][1], z), ...planToWorld(ring[(i + 1) % n][0], ring[(i + 1) % n][1], z));
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
  /** The bay edges whose handles show: all of them with the Bays toggle on, else the two of the selected unit. */
  function visibleBays() {
    const s = Store.raw();
    const all = bayEdges();
    if (s.view.bays) return all;
    if (sel && sel.kind === 'unit') return all.filter((e) => e.a === sel.k || e.b === sel.k);
    return [];
  }
  let handles = [];
  function refreshOverlay() {
    if (!ready || !group) return;
    clearGroup(group);
    handles = [];
    if (Render.comparing() || draw) { Render.requestRender(); return; }
    const z = topZ() + 0.12;
    const ring = selRing();
    if (ring) {
      const accent = cssColorOf('--accent', '#23508f'), halo = cssColorOf('--surface', '#ffffff');
      const pos = ringPos(ring, z);
      const a = fatLine(pos, halo, 5.5, 0.85, 11), b = fatLine(pos, accent, 3, 1, 12);
      if (a) group.add(a); if (b) group.add(b);
    }
    handles = visibleBays().map((e) => ({ e, w: planToWorld(e.mid[0], e.mid[1], z) }));
    const d = dots(handles.map((hh) => hh.w), COARSE ? 24 : 13);       // 44 pt touch handle on a touch screen (rework plan 7.2)
    if (d) group.add(d);
    Render.requestRender();
  }

  /* ---- the two widths beside a dragged bay line (rework plan 7.2) ------------------------------------------------------- */
  let widthLabel = null;
  function clearBayWidths() {
    if (widthLabel && previewGroup) { previewGroup.remove(widthLabel); if (widthLabel.geometry) widthLabel.geometry.dispose(); if (widthLabel.material) { if (widthLabel.material.map) widthLabel.material.map.dispose(); widthLabel.material.dispose(); } }
    widthLabel = null;
    Render.requestRender();
  }
  function showBayWidths(e, delta, base) {
    if (!previewGroup) return;
    clearBayWidths();
    const m = bayMove(e, delta, base);
    const ub = D().bounds.union, unit = clamp(Math.max(ub.maxX - ub.minX, ub.maxY - ub.minY) / 300, 1, 2.2);
    const len = Math.hypot(e.q[0] - e.p[0], e.q[1] - e.p[1]) || 1;
    const along = [(e.q[0] - e.p[0]) / len, (e.q[1] - e.p[1]) / len];
    const x = e.mid[0] + e.t[0] * delta + along[0] * len * 0.28, y = e.mid[1] + e.t[1] * delta + along[1] * len * 0.28;
    widthLabel = Overlays.label(`${fmt(m.wa)}  |  ${fmt(m.wb)}`, x, y, topZ() + 0.35, { height: 2.4 * unit, color: m.ok ? '#1d2733' : CONFIG.flagColor });
    widthLabel.userData.bayWidths = true;
    previewGroup.add(widthLabel);
    Render.requestRender();
  }

  /* ---- drawing (a polygon plate, or the two corners of a block) ------------------------------------------------------ */
  const DRAWS = {
    polygon: { word: 'plate outline', min: 3, closed: true },
    rect: { word: 'block', min: 2, max: 2, closed: false },
    unit: { word: 'unit', min: 2, max: 2, closed: false },          // two taps on one run (rework plan 7.2)
  };
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
    const k = DRAWS[draw.kind], n = draw.pts.length;
    $('drawText').textContent = draw.kind === 'unit'
      ? (n < 1 ? 'Draw a unit: tap the first cut line on a run.' : 'Draw a unit: tap the second cut line on the same run.')
      : draw.kind === 'rect'
      ? (n < 1 ? `Add ${draw.label || 'a block'}: tap the first corner.` : `Add ${draw.label || 'a block'}: tap the opposite corner.`)
      : (n < 1 ? 'Draw the plate outline: tap the first point.' : `Drawing the plate outline: ${n} point${n === 1 ? '' : 's'}. Tap the first point or press Enter to finish. Esc cancels.`);
    $('drawFinish').disabled = n < k.min;
  }
  function startDraw(kind, opts = {}) {
    if (!ready || !DRAWS[kind]) return false;
    if (Render.comparing()) { Toast.show('Leave Compare to draw.', 'warn'); return false; }
    clear();
    draw = { kind, pts: [], target: opts.target || null, label: opts.label || null };
    hover = null;
    if (Render.info().preset !== 'plan') Render.setView('plan', true);
    syncDrawBar();
    renderPreview();
    refreshOverlay();
    const c = Render.canvas();
    if (c) c.classList.add('is-drawing');
    return true;
  }
  function endDraw() {
    draw = null; hover = null;
    syncDrawBar();
    if (previewGroup) clearGroup(previewGroup);
    const c = Render.canvas();
    if (c) c.classList.remove('is-drawing');
    Render.requestRender();
  }
  function cancelDraw() { if (!draw) return false; endDraw(); refreshOverlay(); return true; }
  function renderPreview() {
    if (!previewGroup) return;
    clearGroup(previewGroup);
    if (!draw) return;
    const z = topZ() + 0.3;
    const accent = cssColorOf('--accent', '#23508f');
    const pts = hover ? draw.pts.concat([[hover.x, hover.y]]) : draw.pts;
    if (draw.kind === 'unit' && pts.length === 2) {
      const l = fatLine(ringPos(pts, z, false), accent, 3, 1, 12, true);
      if (l) previewGroup.add(l);
    } else if (draw.kind === 'rect' && pts.length === 2) {
      const r = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
      const l = fatLine(ringPos(rectRing(r), z), accent, 3, 1, 12, true);
      if (l) previewGroup.add(l);
    } else if (draw.kind === 'polygon' && pts.length >= 2) {
      const l = fatLine(ringPos(pts, z, pts.length >= 3), accent, 3, 1, 12, true);
      if (l) previewGroup.add(l);
    }
    const d = dots(draw.pts.map((p) => planToWorld(p[0], p[1], z)), 13);
    if (d) previewGroup.add(d);
    if (hover) { const h2 = dots([planToWorld(hover.x, hover.y, z)], 9, 0xdde6f3); if (h2) previewGroup.add(h2); }
    Render.requestRender();
  }
  function addDrawPoint(cx, cy, alt) {
    const s = snapAt(cx, cy, alt);
    if (!s) return false;
    const k = DRAWS[draw.kind];
    const first = draw.pts[0];
    const tol = clamp(14 / pxPerFt(s.x, s.y), 0.5, 80);
    if (draw.kind === 'polygon' && draw.pts.length >= k.min && first && Math.hypot(first[0] - s.x, first[1] - s.y) <= tol) { finishDraw(); return true; }
    const last = draw.pts[draw.pts.length - 1];
    if (last && Math.hypot(last[0] - s.x, last[1] - s.y) <= tol) { if (draw.pts.length >= k.min) { finishDraw(); return true; } return false; }
    draw.pts.push([s.x, s.y]);
    hover = null;
    syncDrawBar();
    renderPreview();
    if (k.max && draw.pts.length >= k.max) finishDraw();
    return true;
  }
  const DRAW_UNIT_WORDS = { 'off the run': 'Tap two points inside the units or the unfilled run.', 'other run': 'Tap two points on the same run.', 'too narrow': 'That unit is too narrow. Tap two points farther apart.', 'no band': 'No room for a unit between those points.' };
  function finishDraw() {
    if (!draw) return null;
    const k = DRAWS[draw.kind], pts = draw.pts.map((p) => [rnd(p[0]), rnd(p[1])]);
    if (pts.length < k.min) { Toast.show(`A ${k.word} needs at least ${k.min} points.`, 'warn'); return null; }
    const kind = draw.kind, target = draw.target;
    endDraw();
    if (kind === 'unit') {
      const r = drawUnitBetween(pts[0], pts[1]);
      if (!r.ok) { Toast.show(DRAW_UNIT_WORDS[r.reason] || 'The unit did not fit there. Tap two points on one run.', 'warn', 5000); return null; }
      Toast.show(`Unit drawn: ${typeOf(r.type) ? typeOf(r.type).name : r.type}, ${fmt(r.width)} wide.`);
      return { kind, ...r };
    }
    if (kind === 'polygon') {
      const ring = ringArea(pts) < 0 ? pts.slice().reverse() : pts;
      if (Math.abs(ringArea(ring)) < 100) { Toast.show('That outline is too small.', 'warn'); return null; }
      const cur = Store.get('plate');
      Store.set('plate', { ...cur, shape: 'polygon', points: ring }, { live: false });
      if (Store.get('source') !== 'drawn') Store.set('source', 'drawn', { live: false, merge: true });
      Toast.show('Plate outline set.');
      return { kind };
    }
    const r = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
    if (r[2] - r[0] < 2 || r[3] - r[1] < 2) { Toast.show('That block is too small.', 'warn'); return null; }
    return addBlock(target, r);
  }
  /** Adds a block from a rectangle: target { type: 'support', kind } | { type: 'stair' } | { type: 'core' }. */
  function addBlock(target, r) {
    const s = Store.raw();
    target = target || { type: 'support', kind: 'storage' };
    let item = null;
    if (target.type === 'support') {
      if (s.support.length >= CONFIG.limits.maxSupport) { Toast.show(`The limit is ${CONFIG.limits.maxSupport} support blocks.`, 'warn'); return null; }
      let n = 1; while (s.support.some((b) => b.id === `B${n}`)) n++;
      const id = `B${n}`;
      Store.set('support', [...s.support, { id, kind: target.kind || 'storage', rect: r }], { live: false });
      item = { kind: 'support', id };
    } else if (target.type === 'stair') {
      const items = manualStairs();
      if (items.length >= CONFIG.limits.maxStairs) { Toast.show(`The limit is ${CONFIG.limits.maxStairs} stairs.`, 'warn'); return null; }
      let n = 1; while (items.some((b) => b.id === `S${n}`)) n++;
      const id = `S${n}`;
      Store.set('stairs', { ...s.stairs, mode: 'manual', items: [...items, { id, rect: r }] }, { live: false });
      item = { kind: 'stair', id };
    } else if (target.type === 'core') {
      setCoreRect(r, false);
      item = { kind: 'core', id: 'core' };
    }
    if (item) setSel(item);
    return item;
  }
  /** The stair items of the state in manual mode: the current stairs of the editing level when the state still uses auto or seeds. */
  function manualStairs() {
    const s = Store.raw();
    if (s.stairs.mode === 'manual') return s.stairs.items.map((b) => ({ id: b.id, rect: b.rect.slice() }));
    const L = editing();
    return L ? L.stairs.map((b) => ({ id: b.id, rect: ringRect(b.outer).map(rnd3) })) : [];
  }

  /* ---- editing blocks --------------------------------------------------------------------------------------------- */
  function rectOf(it) {
    const s = Store.raw();
    if (it.kind === 'core') { const r = s.core.mode === 'manual' && s.core.rect; if (r) return r.slice(); const L = editing(); return L && L.core ? ringRect(L.core).map(rnd3) : null; }
    if (it.kind === 'support') { const b = s.support.find((x) => x.id === it.id); return b ? b.rect.slice() : null; }
    if (it.kind === 'stair') { const m = manualStairs().find((x) => x.id === it.id); return m ? m.rect : null; }
    return null;
  }
  /** Moves a block to `rect`. Returns false when the block cannot move (the project core comes from the massing). */
  function setBlockRect(it, rect, live = false) {
    const s = Store.raw();
    const r = rect.map(rnd3);
    if (it.kind === 'core') return setCoreRect(r, live);       // a drag sets the core to Manual (rework plan 7.2)
    if (it.kind === 'support') {
      const i = s.support.findIndex((x) => x.id === it.id);
      if (i < 0) return false;
      return Store.set(`support.${i}.rect`, r, { live }), true;
    }
    if (it.kind === 'stair') {
      const items = manualStairs();
      const i = items.findIndex((x) => x.id === it.id);
      if (i < 0) return false;
      items[i] = { ...items[i], rect: r };
      if (s.stairs.mode !== 'manual') Store.set('stairs.mode', 'manual', { live });
      return Store.set('stairs.items', items, { live }), true;
    }
    return false;
  }
  const noted = {};
  function noticeOnce(key, text) { if (noted[key]) return; noted[key] = true; Toast.show(text, 'warn', 6000); setTimeout(() => { delete noted[key]; }, 8000); }
  function deleteBlock(it) {
    const s = Store.raw();
    if (!it) return false;
    if (it.kind === 'support') {
      if (!isUserSupport(it.id)) { Toast.show('This block comes from the fill. Edit the hotel back-of-house or the mix to remove it.', 'warn', 5000); return false; }
      Store.set('support', s.support.filter((x) => x.id !== it.id), { live: false });
      clear();
      return true;
    }
    if (it.kind === 'stair') {
      if (s.stairs.mode !== 'manual') { Toast.show('Stairs follow the Stairs setting. Switch to Manual to remove one.', 'warn', 5000); return false; }
      Store.set('stairs.items', s.stairs.items.filter((x) => x.id !== it.id), { live: false });
      clear();
      return true;
    }
    if (it.kind === 'core') {
      Store.set('core', { mode: 'none', rect: null }, { live: false });
      clear();
      return true;
    }
    return false;
  }
  /** The core takes a rectangle and the mode Manual (one Store write, so one undo step per drag). */
  function setCoreRect(rect, live = false) {
    const r = rect.map(rnd3);
    Store.set('core', { mode: 'manual', rect: r }, { live });
    return true;
  }
  /** Core mode from the panel or the card: 'auto' | 'manual' | 'none'. Manual with no rectangle takes the rectangle of the core now. */
  function setCoreMode(mode) {
    if (!['auto', 'manual', 'none'].includes(mode)) return false;
    const s = Store.raw();
    if (mode === 'manual') {
      const L = editing();
      const r = (s.core.rect && s.core.rect.length === 4 ? s.core.rect : null) || (L && L.core ? ringRect(L.core).map(rnd3) : [-15, -15, 15, 15]);
      return Store.set('core', { mode: 'manual', rect: r }, { live: false }), true;
    }
    return Store.set('core', { mode, rect: mode === 'none' ? null : s.core.rect || null }, { live: false }), true;
  }
  /** "Reset core to auto": the manual rectangle goes and the fill makes the core again. */
  function resetCore() {
    const s = Store.raw();
    if (s.core.mode === 'auto' && !s.core.rect) return false;
    Store.set('core', { mode: 'auto', rect: null }, { live: false });
    if (sel && sel.kind === 'core') onChanged();
    return true;
  }

  /* ---- editing units ------------------------------------------------------------------------------------------------- */
  function toggleLock(k = sel && sel.kind === 'unit' ? sel.k : -1) {
    const u = unitAt(k);
    if (!u) return false;
    const locks = locksNow();
    const i = lockIndexOf(locks, u.outer);
    if (i >= 0) writeLocks(locks.filter((_, j) => j !== i));
    else writeLocks(putLock(locks, u.outer, u.type));
    reselectAt(ringCentroidXY(u.outer));
    return true;
  }
  function reselectAt(pt) {
    const L = editing();
    if (!L) return;
    const k = L.units.findIndex((u) => pointInRing(pt[0], pt[1], u.outer));
    setSel(k >= 0 ? { kind: 'unit', id: String(k), k } : null);
  }
  const unlockAll = () => { const l = locksNow(); if (!l.length) return false; writeLocks([]); return true; };
  /** Re-fill: every unlocked unit is recomputed from the mix (the fill is a pure function of the state), and the project stamp moves to the massing now. */
  function refill() {
    ProjectUI.refill();
    const d = D();
    const L = d.ok ? d.editing : null;
    const locked = L ? L.units.filter((u) => u.locked).length : 0;
    Toast.show(L ? `Re-filled ${L.units.length - locked} unit${L.units.length - locked === 1 ? '' : 's'}${locked ? `, ${locked} locked kept` : ''}.` : 'Nothing to fill.');
    return true;
  }

  /**
   * Changes the type of a unit from the card. The unit becomes a lock with the new type; its width goes to the width the new type
   * prefers at its depth (or the nearest width that lets the run fill), and the rest of the run re-solves around it.
   * → { ok, type, width } | { ok: false, reason }
   */
  function setUnitType(k, typeId) {
    const L = editing(), u = unitAt(k);
    if (!L || !u) return { ok: false, reason: 'no unit' };
    const t = typeOf(typeId);
    if (!t) return { ok: false, reason: 'no type' };
    const fr = frameOf(L, u);
    const rng = rangeFor(typeId, fr.d);
    if (!rng) return { ok: false, reason: 'does not fit' };
    const widths = [rng.w, rng.lo, rng.hi].filter((w, i, a) => a.findIndex((x) => Math.abs(x - w) < 0.01) === i);
    const baseBad = badCount(Store.raw());
    const tries = [];
    for (const w of widths) for (const anchor of ['start', 'end']) {
      const dw = w - fr.w;
      const ring = u.outer.map((p) => {
        const q = dot(p, fr.t);
        const far = anchor === 'start' ? q > (fr.t0 + fr.t1) / 2 : q < (fr.t0 + fr.t1) / 2;
        if (!far) return [p[0], p[1]];
        const sh = anchor === 'start' ? dw : -dw;
        return [p[0] + fr.t[0] * sh, p[1] + fr.t[1] * sh];
      });
      tries.push({ w, anchor, ring });
    }
    let best = null;
    for (const tr of tries) {
      const trial = deepClone(Store.raw());
      const lp = lockHolder(trial);
      if (!lp) continue;
      lp.locks = putLock(lp.locks || [], tr.ring, typeId, u.outer);
      const bad = badCount(trial);
      const score = bad * 1000 + Math.abs(tr.w - rng.w) + (tr.anchor === 'start' ? 0 : 0.01);
      if (!best || score < best.score) best = { ...tr, score, bad };
    }
    if (!best) return { ok: false, reason: 'no room' };
    const pt = ringCentroidXY(u.outer);
    writeLocks(putLock(locksNow(), best.ring, typeId, u.outer));
    reselectAt(ringCentroidXY(best.ring));
    if (best.bad > baseBad) Toast.show('The run is tight: the new width leaves a gap. Move a block or edit the mix.', 'warn', 6000);
    void pt;
    return { ok: true, type: typeId, width: best.w, anchor: best.anchor };
  }
  /** The warnings that mean the fill left a gap (run-too-short and the like) for a trial state. */
  function badCount(trial) {
    try {
      const d = computeDerived(trial, { project: ProjectUI.dataDoc(), fillStamp: ProjectUI.fillStamp(), currentStamp: ProjectUI.massingStamp() });
      return d.ok ? d.warnings.filter((w) => ['run-too-short', 'type-does-not-fit', 'core-blocks-corridor', 'area-closure'].includes(w.id)).length : 99;
    } catch (e) { return 99; }
  }
  /** The object that holds `locks` in a trial copy of the state: the state (drawn) or the editing group (project). */
  function lockHolder(trial) {
    const L = editing();
    if (trial.source === 'project') {
      if (!L || !L.groupId) return null;
      trial.levels.groups[L.groupId] = trial.levels.groups[L.groupId] || { filled: true, locks: [] };
      return trial.levels.groups[L.groupId];
    }
    return trial;
  }

  /* ---- split, merge, fill an unfilled run, draw a unit (rework plan 7.2) ------------------------------------------------ */
  const GEOM = CorridorMod.GEO;
  const MIN_PIECE = 5;                                      // ft: the narrowest piece a split, a merge or a fill makes
  const SNAP_DEFAULT = 0.5;
  /** A rectangle in the run frame of `fr` (t along the run, n into the unit): the strip between t-positions a and b, wide in n. */
  function stripRing(fr, a, b) {
    const pt = (s, q) => [fr.t[0] * s + fr.n[0] * q, fr.t[1] * s + fr.n[1] * q];
    const q0 = fr.n0 - 2, q1 = fr.n1 + 2;
    return [pt(a, q0), pt(b, q0), pt(b, q1), pt(a, q1)];
  }
  /** frameOf with a canonical direction (t points east, or north on a run along y), so that a unit and an unfilled run of one run agree. */
  function canonFrame(L, ring) {
    const f = frameOf(L, { outer: ring });
    const flip = f.t[0] < -1e-9 || (Math.abs(f.t[0]) <= 1e-9 && f.t[1] < 0);
    if (!flip) return f;
    return { t: [-f.t[0], -f.t[1]], n: [-f.n[0], -f.n[1]], t0: -f.t1, t1: -f.t0, n0: -f.n1, n1: -f.n0, w: f.w, d: f.d };
  }
  const sameBand = (a, b) => Math.abs(a.t[0] * b.t[1] - a.t[1] * b.t[0]) < 0.05 && Math.abs(a.n0 - b.n0) < 0.5 && Math.abs(a.n1 - b.n1) < 0.5;
  /** The biggest piece of a ring cut to the strip a..b (as a clean ring), or null. */
  function cutRing(ring, fr, a, b, clipTo = null) {
    let mp = GEOM.bool('int', [{ outer: ring, holes: [] }], [{ outer: stripRing(fr, a, b), holes: [] }]);
    if (clipTo && mp.length) mp = GEOM.bool('int', mp, clipTo);
    mp = mp.filter((q) => Math.abs(ringArea(q.outer)) > 0.25).sort((p, q) => Math.abs(ringArea(q.outer)) - Math.abs(ringArea(p.outer)));
    return mp.length ? cleanOuter(mp[0].outer) : null;
  }
  /** The area-line zone of the editing level: the plate inset by the exterior wall (an unfilled run reaches the plate edge). */
  function areaZone(L) {
    const ext = Number(Store.raw().extWall) || 0;
    return ext > 0 ? GEOM.offsetMP(L.plate, -ext) : L.plate;
  }
  /** The deficit (target less placed) of every type on the editing group, for a tie-break. */
  function deficits() {
    const out = {};
    for (const r of D().hud.mix || []) out[r.type] = (r.target || 0) - (r.count || 0);
    return out;
  }
  /**
   * The type that fits a width best at a depth: the width inside the type's width range first, then an area inside the area range,
   * then the larger deficit, then the width nearest the type's preferred width (then `prefer`). → { id, fits (width in range), areaOk }
   */
  function bestTypeFor(width, depth, { prefer = null } = {}) {
    const hotel = Store.raw().mode === 'hotel', def = deficits();
    let best = null;
    for (const t of mixList()) {
      const [lo, hi] = widthRangeOf(t);
      const miss = width < lo - 0.01 ? lo - width : width > hi + 0.01 ? width - hi : 0;
      const area = width * depth;
      const areaOk = hotel || (area >= t.areaMin - 0.5 && area <= t.areaMax + 0.5);
      const pref = hotel ? (t.target || (lo + hi) / 2) * Math.max(1, t.bays || 1) : t.targetArea / depth;
      const key = [miss > 0 ? 1 : 0, miss, areaOk ? 0 : 1, -(def[t.id] || 0), Math.abs(width - pref), t.id === prefer ? 0 : 1];
      if (!best || cmpKey(key, best.key) < 0) best = { id: t.id, key, fits: miss === 0, areaOk };
    }
    return best;
  }
  const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
  /** Locks without the ones that sit on `rings` (same outline). */
  const withoutLocks = (locks, rings) => locks.filter((l) => !rings.some((r) => sameRing(l.outer, r)));
  const lockRing = (locks, outer, type) => putLock(locks, outer, type, null);
  /** The sort key of a unit along a run, so that "left" is west on a run along x and north on a run along y. */
  const leftKey = (t, c) => (Math.abs(t[0]) >= Math.abs(t[1]) ? c[0] : -c[1]);

  /**
   * Split: the unit becomes two units of half the width. Each half takes the type whose width range holds the half width
   * (deficit order); with no such type it keeps the type of the unit (the half is then flagged). Both halves are locks.
   * → { ok, types: [a, b], widths } | { ok: false, reason }
   */
  function splitUnit(k = sel && sel.kind === 'unit' ? sel.k : -1) {
    const L = editing(), u = unitAt(k);
    if (!L || !u) return { ok: false, reason: 'no unit' };
    const fr = frameOf(L, u);
    if (fr.w < MIN_PIECE * 2 - 1e-6) return { ok: false, reason: 'too narrow' };
    const mid = (fr.t0 + fr.t1) / 2;
    const A = cutRing(u.outer, fr, fr.t0 - 1, mid), B = cutRing(u.outer, fr, mid, fr.t1 + 1);
    if (!A || !B) return { ok: false, reason: 'no cut' };
    const half = fr.w / 2;
    const pick = () => { const b = bestTypeFor(half, fr.d, { prefer: u.type }); return b.fits ? b.id : u.type; };
    const tA = pick(), tB = pick();
    let locks = withoutLocks(locksNow(), [u.outer]);
    locks = lockRing(lockRing(locks, A, tA), B, tB);
    writeLocks(locks);
    reselectAt(ringCentroidXY(A));
    return { ok: true, types: [tA, tB], widths: [half, half] };
  }

  /** The neighbors of a unit across a bay line in the same run: { dir: -1 | 1, j } for "left" and "right". */
  function neighborsOf(k) {
    const L = editing(), u = unitAt(k);
    if (!L || !u) return {};
    const fr = frameOf(L, u), ck = ringCentroidXY(u.outer), key = leftKey(fr.t, ck);
    const out = {};
    for (const e of bayEdges()) {
      if (e.a !== k && e.b !== k) continue;
      const j = e.a === k ? e.b : e.a, v = L.units[j];
      const fj = frameOf(L, v);
      if (Math.abs(fr.t[0] * fj.t[1] - fr.t[1] * fj.t[0]) > 0.05) continue;       // another run
      if (Math.abs(fr.n0 - fj.n0) > 0.5 || Math.abs(fr.n1 - fj.n1) > 0.5) continue;
      const dk = leftKey(fr.t, ringCentroidXY(v.outer)) - key;
      const dir = dk < 0 ? -1 : 1;
      if (!out[dir] || Math.abs(dk) < Math.abs(out[dir].dk)) out[dir] = { j, dk };
    }
    return { '-1': out[-1] ? out[-1].j : null, '1': out[1] ? out[1].j : null };
  }
  /**
   * Merge: the unit and its neighbor on one side (dir -1 = left, 1 = right) become one lock. The type is the best fit of the width.
   * → { ok, type, width } | { ok: false, reason }
   */
  function mergeUnit(dir, k = sel && sel.kind === 'unit' ? sel.k : -1) {
    const L = editing(), u = unitAt(k);
    if (!L || !u) return { ok: false, reason: 'no unit' };
    const j = neighborsOf(k)[String(dir)];
    if (j === null || j === undefined) return { ok: false, reason: 'no neighbor' };
    const v = unitAt(j);
    const mp = GEOM.bool('union', [{ outer: u.outer, holes: [] }], [{ outer: v.outer, holes: [] }]);
    if (mp.length !== 1 || (mp[0].holes || []).length) return { ok: false, reason: 'not one piece' };
    const outer = cleanOuter(mp[0].outer);
    const fr = frameOf(L, { outer });
    const best = bestTypeFor(fr.w, fr.d, { prefer: u.type });
    writeLocks(lockRing(withoutLocks(locksNow(), [u.outer, v.outer]), outer, best.id));
    reselectAt(ringCentroidXY(outer));
    return { ok: true, type: best.id, width: fr.w };
  }

  /** The unfilled runs of the editing level: [{ id, outer, length, depth }]. */
  function remainders() {
    const L = editing();
    if (!L) return [];
    return L.support.filter((b) => b.kind === 'remainder').map((b) => { const fr = frameOf(L, { outer: b.outer }); return { id: b.id, outer: b.outer, length: fr.w, depth: fr.d }; });
  }
  /** The unit counts (1 to 3) that give every piece a width inside the width range of some type. */
  function fitCounts(length) {
    const out = [];
    for (let n = 1; n <= 3; n++) {
      const w = length / n;
      if (mixList().some((t) => { const [lo, hi] = widthRangeOf(t); return w >= lo - 0.01 && w <= hi + 0.01; })) out.push(n);
    }
    return out;
  }
  /** The count that suits a type: the piece width nearest its preferred width, inside its range when it can. */
  function countForType(length, t, depth) {
    const [lo, hi] = widthRangeOf(t);
    const pref = Store.raw().mode === 'hotel' ? (t.target || (lo + hi) / 2) * Math.max(1, t.bays || 1) : t.targetArea / depth;
    let best = null;
    for (let n = 1; n <= 3; n++) {
      const w = length / n, miss = w < lo - 0.01 ? lo - w : w > hi + 0.01 ? w - hi : 0;
      const key = [miss > 0 ? 1 : 0, miss, Math.abs(w - pref)];
      if (!best || cmpKey(key, best.key) < 0) best = { n, key };
    }
    return best.n;
  }
  /**
   * Fill an unfilled run: `count` (1 to 3) locked units of equal width (the pieces of the strip, inside the area line), all of
   * `type` or, with no type, each with the best fit. Without a count the type picks its own count.
   * → { ok, count, types } | { ok: false, reason }
   */
  function fillRemainder(id, { count = null, type = null } = {}) {
    const L = editing();
    const r = remainders().find((x) => x.id === id);
    if (!L || !r) return { ok: false, reason: 'no unfilled run' };
    const t = type ? typeOf(type) : null;
    if (type && !t) return { ok: false, reason: 'no type' };
    const fr = frameOf(L, { outer: r.outer });
    const n = count || (t ? countForType(fr.w, t, fr.d) : (fitCounts(fr.w)[0] || 1));
    if (!(n >= 1 && n <= 3) || fr.w / n < MIN_PIECE - 1e-6) return { ok: false, reason: 'too short' };
    const zone = areaZone(L), w = fr.w / n;
    const pieces = [];
    for (let i = 0; i < n; i++) {
      const ring = cutRing(r.outer, fr, i === 0 ? fr.t0 - 1 : fr.t0 + i * w, i === n - 1 ? fr.t1 + 1 : fr.t0 + (i + 1) * w, zone);
      if (!ring) return { ok: false, reason: 'no cut' };
      pieces.push(ring);
    }
    let locks = withoutLocks(locksNow(), pieces);
    const types = [];
    for (const ring of pieces) {
      const f2 = frameOf(L, { outer: ring });
      const ty = t ? t.id : bestTypeFor(f2.w, f2.d).id;
      types.push(ty);
      locks = lockRing(locks, ring, ty);
    }
    writeLocks(locks);
    reselectAt(ringCentroidXY(pieces[0]));
    return { ok: true, count: n, types };
  }

  /**
   * Draw a unit: two plan points on the same run. The unit spans the band between the two cut lines (snapped to the grid); it
   * becomes a lock with the best-fit type. → { ok, type, width } | { ok: false, reason }
   */
  function drawUnitBetween(p1, p2) {
    const L = editing();
    if (!L) return { ok: false, reason: 'no level' };
    const holders = [...L.units.map((u, k) => ({ kind: 'unit', k, outer: u.outer })), ...L.support.filter((b) => b.kind === 'remainder').map((b) => ({ kind: 'remainder', outer: b.outer }))];
    const at = (p) => holders.find((x) => pointInRing(p[0], p[1], x.outer)) || null;
    const h1 = at(p1), h2 = at(p2);
    if (!h1 || !h2) return { ok: false, reason: 'off the run' };
    const f1 = canonFrame(L, h1.outer), f2 = canonFrame(L, h2.outer);
    if (!sameBand(f1, f2)) return { ok: false, reason: 'other run' };
    const fr = f1;
    const sn = Store.raw().view.snap, g = sn.on ? sn.grid || SNAP_DEFAULT : 0;
    const q = (p) => { const v = p[0] * fr.t[0] + p[1] * fr.t[1]; return g ? Math.round(v / g) * g : v; };
    const a = Math.min(q(p1), q(p2)), b = Math.max(q(p1), q(p2));
    if (b - a < MIN_PIECE - 1e-6) return { ok: false, reason: 'too narrow' };
    // the run: every unit and unfilled run with the same direction and depth band, inside the area line
    const same = holders.filter((x) => sameBand(fr, canonFrame(L, x.outer)));
    const region = GEOM.bool('int', GEOM.bool('union', same.map((x) => ({ outer: x.outer, holes: [] })), []), areaZone(L));
    const stripMP = [{ outer: stripRing(fr, a, b), holes: [] }];
    const piece = GEOM.bool('int', region, stripMP).filter((x) => Math.abs(ringArea(x.outer)) > 0.25).sort((x, y) => Math.abs(ringArea(y.outer)) - Math.abs(ringArea(x.outer)))[0];
    if (!piece) return { ok: false, reason: 'no band' };
    const outer = cleanOuter(piece.outer);
    const fo = frameOf(L, { outer });
    const best = bestTypeFor(fo.w, fo.d);
    // the new lock replaces every lock it covers by more than 1 sf
    const covered = locksNow().filter((l) => { const x = GEOM.bool('int', [{ outer: l.outer, holes: [] }], [{ outer, holes: [] }]); return x.some((m) => Math.abs(ringArea(m.outer)) > 1); }).map((l) => l.outer);
    writeLocks(lockRing(withoutLocks(locksNow(), covered), outer, best.id));
    reselectAt(ringCentroidXY(outer));
    return { ok: true, type: best.id, width: fo.w };
  }

  /* ---- pointer handling ------------------------------------------------------------------------------------------------ */
  const downs = new Map();
  function bayHit(cx, cy, touch) {
    if (draw) return null;
    const rad = touch ? BAY_PX_TOUCH : BAY_PX;
    let best = null;
    for (const hh of handles) {
      const p = toClient(new THREE.Vector3(...hh.w));
      if (p.z < -1 || p.z > 1) continue;
      const dd = Math.hypot(p.x - cx, p.y - cy);
      if (dd <= rad && (!best || dd < best.d)) best = { e: hh.e, d: dd };
    }
    if (best) return best;
    // along the whole line, not only its middle: distance from the pointer to the segment on screen
    if (!Store.raw().view.bays && !(sel && sel.kind === 'unit')) return null;
    for (const e of visibleBays()) {
      const a = screenOf(e.p[0], e.p[1]), b = screenOf(e.q[0], e.q[1]);
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
      const tt = clamp(((cx - a.x) * vx + (cy - a.y) * vy) / L2, 0, 1);
      const dd = Math.hypot(cx - (a.x + vx * tt), cy - (a.y + vy * tt));
      if (dd <= rad * 0.6 && (!best || dd < best.d)) best = { e, d: dd };
    }
    return best;
  }
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (Render.comparing()) return;
    const touch = e.pointerType === 'touch';
    const hit = bayHit(e.clientX, e.clientY, touch);
    if (hit) {
      e.preventDefault(); e.stopImmediatePropagation();
      const base = baseOf(hit.e), lim = bayLimits(hit.e, base);
      drag = { type: 'bay', pointerId: e.pointerId, e: hit.e, started: false, start: planAt(e.clientX, e.clientY), lim, base, prev: { A: base.A, B: base.B }, warned: false };
      try { Render.canvas().setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
      Render.setOrbitEnabled(false);
      return;
    }
    if (sel && sel.kind !== 'unit' && !draw) {
      const p = planAt(e.clientX, e.clientY), ring = selRing();
      if (p && ring && pointInRing(p[0], p[1], ring)) {
        const rect = rectOf(sel);
        if (rect) {
          e.preventDefault(); e.stopImmediatePropagation();
          drag = { type: 'block', pointerId: e.pointerId, it: { ...sel }, rect, start: p, started: false };
          try { Render.canvas().setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          Render.setOrbitEnabled(false);
          return;
        }
      }
    }
    for (const r of downs.values()) r.cancel = true;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), cancel: downs.size > 0 });
  }
  function onMove(e) {
    if (drag && e.pointerId === drag.pointerId) {
      const p = planAt(e.clientX, e.clientY);
      if (!p) return;
      if (drag.type === 'bay') {
        const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
        let d = dx * drag.e.t[0] + dy * drag.e.t[1];
        const sn = Store.raw().view.snap;
        if (sn.on && !e.altKey) d = Math.round(d / (sn.grid || 0.5)) * (sn.grid || 0.5);
        const clampd = clamp(d, drag.lim.back, drag.lim.fwd);
        if (clampd !== d && !drag.warned) { drag.warned = true; Toast.show('That bay is at its limit for the unit type.', 'warn', 2500); }
        if (Math.abs(clampd) < 1e-6 && !drag.started) return;
        drag.started = true;
        moveBay(drag.e, clampd, true, drag.base, drag.prev);
        showBayWidths(drag.e, clampd, drag.base);
        return;
      }
      if (drag.type === 'block') {
        let dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
        const sn = Store.raw().view.snap;
        if (sn.on && !e.altKey) { const g = sn.grid || 0.5; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
        if (!drag.started && Math.hypot(dx, dy) < 0.01) return;
        drag.started = true;
        setBlockRect(drag.it, [drag.rect[0] + dx, drag.rect[1] + dy, drag.rect[2] + dx, drag.rect[3] + dy], true);
      }
      return;
    }
    const r = downs.get(e.pointerId);
    if (r && Math.hypot(e.clientX - r.x, e.clientY - r.y) > PICK_PX) r.cancel = true;
    if (draw && e.pointerType !== 'touch' && !r) {
      const s = snapAt(e.clientX, e.clientY, e.altKey);
      hover = s ? { x: s.x, y: s.y } : null;
      renderPreview();
    }
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return false;
    try { Render.canvas().releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const was = drag.started, d0 = drag;
    drag = null;
    clearBayWidths();
    Render.setOrbitEnabled(true);
    if (was) {
      Store.commit();
      if (d0.type === 'bay') reselectAt(d0.e.mid);
      else sanitize();
    }
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
  }
  function click(cx, cy, alt = false) {
    if (draw) return addDrawPoint(cx, cy, alt);
    const hit = pickAt(cx, cy);
    setSel(hit);
    return hit;
  }

  /* ---- the selection card (#selection-card) ------------------------------------------------------------------------------ */
  let cardRefs = null;
  const BLOCK_WORDS = { core: 'Core', stair: 'Stair', support: 'Support block' };
  const sf = (v) => `${Math.round(v).toLocaleString('en-US')} sf`;
  function renderCard() {
    const card = $('selection-card');
    if (!card) return;
    card.textContent = '';
    cardRefs = null;
    if (!sel || !selRing()) { card.hidden = true; return; }
    card.hidden = false;
    const refs = cardRefs = {};
    refs.title = h('b', { class: 'sc-name', id: 'itemTitle' });
    refs.sub = h('span', { class: 'sc-sub', id: 'itemSub' });
    const clearBtn = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', html: ICON_X, onclick: clear });
    card.append(h('div', { class: 'sc-head' }, h('div', { class: 'sc-titles' }, refs.title, refs.sub), clearBtn));
    refs.kv = h('dl', { class: 'kv', id: 'itemKv' });
    card.append(refs.kv);
    refs.types = h('div', { class: 'chips sc-types', id: 'itemTypes', role: 'group', 'aria-label': 'Unit type' });
    card.append(refs.types);
    refs.actions = h('div', { class: 'sc-actions' });
    card.append(refs.actions);
    syncCardText();
  }
  function describeUnit(u, L) {
    const fr = frameOf(L, u);
    const t = typeOf(u.type);
    const rows = [
      ['Type', u.typeName],
      ['Area', sf(u.area)],
      ['Width x depth', `${fmt(fr.w)} x ${fmt(fr.d)}`],
      ['Exposures', u.exposures.length ? u.exposures.join(' ') : 'none'],
    ];
    if (u.corner) rows.push(['Corner', 'wrap unit']);
    if (u.accessible) rows.push(['Accessible', typeof u.accessible === 'string' ? u.accessible : 'yes']);
    const flags = [];
    if (u.areaHigh && t) flags.push(`Large: the area is above the ${Math.round(t.areaMin)} to ${Math.round(t.areaMax)} sf range of this type. The run is deep.`);
    if (u.flagged && t) {
      if (Store.raw().mode === 'hotel') flags.push(`Width is outside ${t.widthMin} to ${t.widthMax} ft`);
      else flags.push(`Area is outside ${Math.round(t.areaMin)} to ${Math.round(t.areaMax)} sf`);
    }
    if (u.locked) flags.push('Locked: keeps its outline and type through a re-fill');
    if (flags.length) rows.push(['Flags', flags.join('. ')]);
    return { title: `Unit ${u.id}`, sub: `${u.typeName}, ${sf(u.area)}`, rows };
  }
  function syncCardText() {
    if (!cardRefs || !sel) return;
    const L = editing();
    if (!L) return;
    let info = null;
    cardRefs.actions.textContent = '';
    cardRefs.types.textContent = '';
    cardRefs.types.hidden = true;
    const typeChips = (onPick, current) => {
      cardRefs.types.hidden = false;
      const deep = new Set(D().hud.deep || []);
      for (const t of mixList()) {
        cardRefs.types.append(h('button', { class: 'chip', type: 'button', 'data-type': t.id, 'aria-pressed': String(t.id === current), title: `${deep.has(t.id) ? 'Large at this depth. ' : ''}${t.name}`, onclick: () => onPick(t) },
          h('span', { class: 'sw', style: `background:${t.color}` }), t.name, deep.has(t.id) ? h('span', { class: 'tag-large' }, 'large') : null));
      }
    };
    if (sel.kind === 'unit') {
      const u = unitAt(sel.k);
      if (!u) return;
      info = describeUnit(u, L);
      typeChips((t) => { const r = setUnitType(sel.k, t.id); if (!r.ok) Toast.show(`${t.name} does not fit this run.`, 'warn', 4000); }, u.type);
      const fr = frameOf(L, u), nb = neighborsOf(sel.k);
      cardRefs.actions.append(
        h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'lock', 'aria-pressed': String(u.locked), onclick: () => toggleLock() }, u.locked ? 'Unlock' : 'Lock (L)'),
        h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'split', disabled: fr.w < MIN_PIECE * 2 - 1e-6, title: 'Cut the unit into two units of half the width', onclick: () => { const r = splitUnit(); if (!r.ok) Toast.show('The unit is too narrow to split.', 'warn', 4000); } }, 'Split'),
        h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'merge-left', disabled: nb['-1'] === null, title: 'Join this unit and the unit on its left', onclick: () => { const r = mergeUnit(-1); if (!r.ok) Toast.show('These two units do not join into one piece.', 'warn', 4000); } }, 'Merge \u2190'),
        h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'merge-right', disabled: nb['1'] === null, title: 'Join this unit and the unit on its right', onclick: () => { const r = mergeUnit(1); if (!r.ok) Toast.show('These two units do not join into one piece.', 'warn', 4000); } }, 'Merge \u2192'));
    } else if (sel.kind === 'remainder') {
      const r = remainders().find((x) => x.id === sel.id);
      if (!r) return;
      const counts = fitCounts(r.length);
      info = {
        title: 'Unfilled run', sub: `${fmt(r.length)} long, ${sf(Math.abs(ringArea(r.outer)))}`,
        rows: [['Length', fmt(r.length)], ['Depth', fmt(r.depth)], ['Why', 'The run is shorter than the narrowest unit.'], ['Fill', counts.length ? 'Pick a count or a type. The units split the run evenly and lock.' : 'No count of units fits this length. Move a block or the core.']],
      };
      typeChips((t) => { const x = fillRemainder(sel.id, { type: t.id }); if (!x.ok) Toast.show('The run is too short for that type.', 'warn', 4000); }, null);
      for (const n of [1, 2, 3]) {
        cardRefs.actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': `fill-${n}`, disabled: !counts.includes(n), title: counts.includes(n) ? `${n} unit${n === 1 ? '' : 's'} of ${fmt(r.length / n)}` : 'That width is outside every type range', onclick: () => { const x = fillRemainder(sel.id, { count: n }); if (!x.ok) Toast.show('The run is too short for that count.', 'warn', 4000); } }, `${n} unit${n === 1 ? '' : 's'}`));
      }
    } else {
      const r = rectOf(sel);
      const ring = selRing();
      const area = ring ? Math.abs(ringArea(ring)) : 0;
      let label = BLOCK_WORDS[sel.kind] || sel.kind;
      if (sel.kind === 'support') { const b = L.support.find((x) => x.id === sel.id); if (b) label = `${b.kind.charAt(0).toUpperCase()}${b.kind.slice(1)} block`; }
      info = { title: sel.kind === 'core' ? 'Core' : `${label} ${sel.id}`, sub: sf(area), rows: r ? [['Size', `${fmt(r[2] - r[0])} x ${fmt(r[3] - r[1])}`], ['Lower left', `${fmt(r[0])}, ${fmt(r[1])}`]] : [['Area', sf(area)]] };
      if (sel.kind === 'core') {
        const cm = Store.raw().core.mode, prog = D().hud.core;
        info.rows.push(['Mode', { auto: 'Auto: the fill makes the core', manual: 'Manual: you set the rectangle', none: 'None' }[cm] || cm]);
        if (prog && prog.cabs !== null && prog.cabs !== undefined) info.rows.push(['Elevators', `${prog.cabs} passenger${prog.service ? `, ${prog.service} service` : ''}`]);
        info.rows.push(['Move it', 'Drag the core. It becomes Manual.']);
        cardRefs.actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'reset-core', disabled: cm === 'auto' && !Store.raw().core.rect, onclick: () => resetCore() }, 'Reset core to auto'));
      }
      if (sel.kind === 'stair' && Store.raw().stairs.mode !== 'manual') info.rows.push(['Mode', 'Moving it switches the stairs to Manual']);
      if (sel.kind === 'support' && !isUserSupport(sel.id)) info.rows.push(['Source', 'from the fill']);
      if ((sel.kind === 'support' && isUserSupport(sel.id)) || (sel.kind === 'stair' && Store.raw().stairs.mode === 'manual') || sel.kind === 'core') {
        cardRefs.actions.append(h('button', { class: 'btn outline sm danger-text', type: 'button', 'data-action': 'delete', onclick: () => deleteBlock(sel) }, sel.kind === 'core' ? 'Remove core' : 'Delete'));
      }
    }
    cardRefs.title.textContent = info.title;
    cardRefs.sub.textContent = info.sub || '';
    cardRefs.kv.textContent = '';
    for (const [k, v] of info.rows) cardRefs.kv.append(h('dt', null, k), h('dd', null, v));
  }

  /* ---- keyboard (Mac shortcuts) -------------------------------------------------------------------------------------------- */
  const VIEW_KEYS = { 1: 'axon', 2: 'n', 3: 'e', 4: 's', 5: 'w', 6: 'plan' };
  function typing(e) {
    const t = e.target, a = document.activeElement;
    const inField = (n) => !!n && n.nodeType === 1 && (n.matches('input, textarea, select') || n.isContentEditable);
    return inField(t) || inField(a);
  }
  function menuOpen() { return Pop.isOpen() || !!document.querySelector('.modal-back'); }
  function onKey(e) {
    if (!ready || typing(e) || menuOpen()) return;
    if (Compare.isActive()) return;
    const key = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (key === 'Escape') {
      if (draw) { cancelDraw(); e.preventDefault(); } else if (sel) { clear(); e.preventDefault(); }
      return;
    }
    if (key === 'Enter' && draw) { e.preventDefault(); finishDraw(); return; }
    if ((key === 'Delete' || key === 'Backspace') && sel && sel.kind !== 'unit' && !draw) { e.preventDefault(); deleteBlock(sel); return; }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'diagram' ? 'model' : 'diagram', { live: false }); return; }
    if (key === 'l' || key === 'L') { e.preventDefault(); toggleLock(); return; }
    if (key === 'f' || key === 'F') { e.preventDefault(); refill(); }
  }

  function init() {
    ready = Render.ready();
    drawBar();
    if (!$('selection-card')) return;
    Store.subscribe(() => {
      sanitize();
      syncCardText();
      refreshOverlay();
    });
    if (!ready) return;
    initOverlay();
    initPointer();
    window.addEventListener('keydown', onKey, true);
    Render.onRebuild(() => { sanitize(); refreshOverlay(); syncCardText(); });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener('change', refreshOverlay) : mq.addListener(refreshOverlay));
    window.addEventListener('resize', () => Render.requestRender());
  }

  return {
    init,
    select: (it) => setSel(it), clear,
    get: () => (sel ? { ...sel } : null), count: () => (sel ? 1 : 0),
    pickAt, click, planAt, snapPoint, screenOf,
    startDraw, cancelDraw, finishDraw, drawing: () => (draw ? { kind: draw.kind, points: draw.pts.length } : null),
    drawTap: (cx, cy, alt) => (draw ? addDrawPoint(cx, cy, !!alt) : false),
    drawPoint: (x, y) => { if (!draw) return false; draw.pts.push([x, y]); syncDrawBar(); renderPreview(); return true; },
    addBlock, deleteBlock, setBlockRect, rectOf, setCoreMode, resetCore,
    // split, merge, unfilled runs, draw a unit
    splitUnit, mergeUnit, neighbors: (k) => neighborsOf(k), remainders, fillRemainder, drawUnitBetween, fitCounts, bestTypeFor: (w, d) => bestTypeFor(w, d),
    // units and locks
    selectUnit: (k) => setSel({ kind: 'unit', id: String(k), k }), toggleLock, unlockAll, setUnitType, refill, locks: locksNow, frameOf: (k) => { const L = editing(); const u = unitAt(k); return L && u ? frameOf(L, u) : null; },
    // bay lines
    bays: () => bayEdges().map((e) => ({ a: e.a, b: e.b, mid: e.mid.slice(), t: e.t.slice() })),
    bayLimits: (i) => { const e = bayEdges()[i]; return e ? bayLimits(e) : null; },
    moveBay: (i, delta, live = false) => { const e = bayEdges()[i]; if (!e) return false; const ok = moveBay(e, delta, live); if (ok && !live) reselectAt(e.mid); return ok; },
    bayScreen: (i) => { const e = bayEdges()[i]; return e ? screenOf(e.mid[0], e.mid[1], topZ() + 0.12) : null; },
    onChange: (fn) => listeners.push(fn), refreshOverlay,
    overlayInfo: () => ({ outline: group ? group.children.length : 0, preview: previewGroup ? previewGroup.children.length : 0, handles: handles.length }),
  };
})();
