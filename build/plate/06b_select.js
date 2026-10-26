/* ==========================================================================
   DRAW, SELECT and EDIT  (docs/plate-planner-draw-plan.md section 4)
   The plate starts blank. The architect draws the units with five tools (the palette in the top-left of the plan):
     Paint (P, the default)  press on an open stretch of a run and drag along it: the unit spans the band, the live label shows the area and
                             the type match, release makes the unit. A tap on an open stretch selects it. A drag that starts in an empty
                             corner zone makes the corner unit.
     Suggest (S)             tap an open stretch or an empty corner zone: ghost units appear (dashed, type colors). Accept all, tap a ghost to
                             accept one, Dismiss, or Escape. (The card of a selected stretch has the same Suggest button in any tool.)
     Rectangle (R), Polygon (G)  free units: two corners (press and drag, or two taps), or taps for a polygon. The ring is clipped to the unit zone.
     Select (V)              tap a unit: type chips, area, match, Split, Merge, Delete. Drag the shared bay line of two run units on one run.
   The core (tap it in any tool): drag to move, the four corner handles resize (0.5 ft, 10 by 10 ft at least); the mode becomes Manual.
   Mac keys: P S R G V choose a tool, 1 to 6 views, D Model/Diagram, Delete removes the selected unit or block, Escape dismisses, then clears.

   The rules live in src/plate/draw.js (DrawMod) and src/plate/suggest.js (SuggestMod); this file only reads the layout (Derived group fill),
   asks them for a result and writes the drawn units to the Store: `units` for a drawn plate, `levels.groups[gid].units` for a project group.
   Every edit is one Store write, so Undo and Redo work. Selection, ghosts and the drawing in progress live HERE, never in the Store.

   Picking is plane math: a ray to the plane at the elevation of the editing level, then the plan point is tested against rings. There are no
   picking meshes. A bay line or a core handle is hit within 16 px (28 px on touch: a target wider than 44 pt).
   ========================================================================== */
const Select = (() => {
  const $ = (id) => document.getElementById(id);
  const PICK_PX = 6, PICK_MS = 400, BAY_PX = 16, BAY_PX_TOUCH = 28;
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const CORE_STEP = 0.5, CORE_MIN = 10;
  const D = () => Derived.get();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let sel = null, ready = false, draw = null, drag = null, hover = null, paint = null, ghosts = null, tool = 'paint', internal = 0;
  const listeners = [], toolListeners = [];
  let group = null, previewGroup = null, ghostGroup = null, dotTexture = null;
  const fmt = (v) => Units.formatFeetInches(v);
  const sf = (v) => `${Math.round(v).toLocaleString('en-US')} sf`;
  const GEOM = CorridorMod.GEO;
  const MATCH_WORDS = { 'in-range': 'in range', large: 'large', small: 'small' };

  /* ---- level, layout, units ---------------------------------------------------------------------------------- */
  const editing = () => { const d = D(); return d.ok ? d.editing : null; };
  const unitAt = (k) => { const L = editing(); return L && L.units[k] ? L.units[k] : null; };
  const unitByUid = (uid) => { const L = editing(); return L && uid ? L.units.find((u) => u.uid === uid) || null : null; };
  /** The layout of the editing group (draw plan 2.2: runs, free stretches, corner zones, units, zone), or null. */
  const layout = () => { const d = D(); const f = d.ok && d.group ? d.group.fill : null; return f && f.layout ? f : null; };
  const mixList = () => { const s = Store.raw(); return (s.mix && s.mix[s.mode]) || []; };
  const typeOf = (id) => mixList().find((t) => t.id === id) || null;
  const typeName = (id) => { const t = typeOf(id); return t ? t.name : id; };
  const typeColor = (id) => { const t = typeOf(id); return t ? t.color : '#9aa3ad'; };
  const isHotel = () => Store.raw().mode === 'hotel';
  const unitsPath = () => {
    const s = Store.raw(), L = editing();
    if (s.source === 'project') return L && L.groupId ? `levels.groups.${L.groupId}.units` : null;
    return 'units';
  };
  const unitsNow = () => { const p = unitsPath(); const v = p ? Store.get(p) : null; return Array.isArray(v) ? v : []; };
  /** Writes the unit list (one Store write = one undo step unless live). A project group with no entry yet gets a whole entry. */
  function writeUnits(next, live = false) {
    const p = unitsPath();
    if (!p) return false;
    const s = Store.raw(), L = editing();
    internal++;
    try {
      if (s.source === 'project' && !(s.levels.groups && s.levels.groups[L.groupId])) Store.set(`levels.groups.${L.groupId}`, { filled: true, units: next }, { live });
      else Store.set(p, next, { live });
    } finally { internal--; }
    return true;
  }
  const rnd3 = (v) => Math.round(v * 1000) / 1000;
  const cleanOuter = (ring) => ring.map((p) => [rnd3(p[0]), rnd3(p[1])]);
  const stateUnit = (uid) => unitsNow().find((u) => u.id === uid) || null;
  /** A short sentence for a match: "812 sf, 1BR, in range". */
  const matchLine = (area, type, match, width = null) => `${width !== null && isHotel() ? `${fmt(width)} · ` : ''}${sf(area)} · ${typeName(type)}, ${MATCH_WORDS[match] || match}`;
  const rangeText = (t) => (isHotel() ? `${t.widthMin * Math.max(1, t.bays || 1)} to ${t.widthMax * Math.max(1, t.bays || 1)} ft wide` : `${Math.round(t.areaMin)} to ${Math.round(t.areaMax)} sf`);

  /* ---- geometry ---------------------------------------------------------------------------------------------- */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const unitVec = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const extent = (ring, v) => { let lo = Infinity, hi = -Infinity; for (const p of ring) { const q = dot(p, v); if (q < lo) lo = q; if (q > hi) hi = q; } return [lo, hi]; };
  const inMP = (mp, x, y) => (mp || []).some((pc) => pointInRing(x, y, pc.outer) && !(pc.holes || []).some((h2) => pointInRing(x, y, h2)));
  const runById = (id) => { const lay = layout(); return lay ? (lay.runs || []).find((r) => r.id === id) || (lay.leftoverRuns || []).find((r) => r.id === id) || null : null; };
  /** The layout with the runs of the leftover pieces as runs, each with one open stretch (leftover fix): the paint and the
   *  suggestions treat a leftover as an open stretch; the first unit drawn there opens the piece (fill.js layoutLevel). */
  function layoutPlus() {
    const lay = layout();
    if (!lay || !(lay.leftoverRuns || []).length) return lay;
    return { ...lay, runs: [...lay.runs, ...lay.leftoverRuns], free: [...lay.free, ...lay.leftoverRuns.map((r) => r.stretch)] };
  }
  /** A leftover support piece of the layout (it names its run; the derived support does not carry it). */
  const leftoverOf = (id) => { const lay = layout(); const b = lay ? (lay.support || []).find((x) => x.id === id && x.kind === 'leftover') : null; return b && b.run ? b : null; };
  const leftoverRunOf = (b) => { const lay = layout(); return b && lay ? (lay.leftoverRuns || []).find((r) => r.id === b.run) || null : null; };
  const runS = (run, p) => dot(sub(p, run.start), run.u);
  const runPoint = (run, s, t = 0) => [run.start[0] + run.u[0] * s + run.n[0] * t, run.start[1] + run.u[1] * s + run.n[1] * t];
  /** The size of a unit: width along its run (or its longer side) and depth across it. */
  function sizeOf(u) {
    const run = u.runId ? runById(u.runId) : null;
    let t = run ? run.u : null, n = run ? run.n : null;
    if (!t) {
      const b = boxOfRings([u.outer]);
      const alongX = b.maxX - b.minX >= b.maxY - b.minY;
      t = alongX ? [1, 0] : [0, 1]; n = alongX ? [0, 1] : [1, 0];
    }
    const [t0, t1] = extent(u.outer, t), [n0, n1] = extent(u.outer, n);
    return { w: t1 - t0, d: n1 - n0 };
  }
  /** The ring of an open stretch: the run band between its two ends. */
  function stretchRing(f) {
    const run = runById(f.runId);
    if (!run) return null;
    const pc = GEOM.bool('int', run.band, [{ outer: GEOM.frameRect({ o: run.start, u: run.u, n: run.n }, f.a, f.b, -1, 1e4), holes: [] }])
      .sort((p, q) => Math.abs(ringArea(q.outer)) - Math.abs(ringArea(p.outer)))[0];
    if (pc) return pc.outer;
    const o = run.start, a = f.a, b = f.b, d = f.depth || run.depth;
    return [runPoint(run, a, 0), runPoint(run, b, 0), runPoint(run, b, d), runPoint(run, a, d)];
  }
  const freeById = (id) => { const lay = layout(); return lay ? (lay.free || []).find((f) => f.id === id) || null : null; };
  const zoneById = (id) => { const lay = layout(); return lay ? (lay.cornerZones || []).find((z) => z.id === id) || null : null; };
  const freeSel = () => (sel && sel.kind === 'free' ? freeById(sel.id) : null);

  /** The shared edges of the editing level: { a, b, p, q, t, mid } with a, b the unit indices and t the unit vector from a toward b.
   *  `run`, `s`, `uidA` and `uidB` are set when the two units are run units on one run (the bay line can be dragged: draw plan 4). */
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
          const tb0 = dot([b0[0] - a0[0], b0[1] - a0[1]], ua), tb1 = dot([b1[0] - a0[0], b1[1] - a0[1]], ua);
          const lo = Math.max(0, Math.min(tb0, tb1)), hi = Math.min(la, Math.max(tb0, tb1));
          if (hi - lo < 1) continue;
          const p = [a0[0] + ua[0] * lo, a0[1] + ua[1] * lo], q = [a0[0] + ua[0] * hi, a0[1] + ua[1] * hi];
          const perp = [-ua[1], ua[0]];
          const ca = ringCentroidXY(A), cb = ringCentroidXY(B);
          let t = perp;
          if (dot([cb[0] - ca[0], cb[1] - ca[1]], t) < 0) t = [-t[0], -t[1]];
          const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const e = { a: i, b: j, p, q, t, mid, run: null, s: null, uidA: U[i].uid, uidB: U[j].uid };
          if (U[i].mode === 'run' && U[j].mode === 'run' && U[i].runId && U[i].runId === U[j].runId) {
            const run = runById(U[i].runId);
            if (run && Math.abs(dot(ua, run.u)) < 0.05) { e.run = run.id; e.s = runS(run, mid); }
          }
          list.push(e);
        }
      }
    }
    bayCache = { key: d.geomId, list };
    return list;
  }
  const dragBays = () => bayEdges().filter((e) => e.run);

  /* ---- selection --------------------------------------------------------------------------------------------- */
  function setSel(next) {
    const n = next ? { ...next } : null;
    const changed = JSON.stringify(n) !== JSON.stringify(sel);
    sel = n;
    if (changed) onChanged();
    return changed;
  }
  const clear = () => setSel(null);
  function onChanged() {
    if (ghosts && !(sel && ghosts.forId === sel.id && ghosts.forKind === sel.kind)) { ghosts = null; renderGhosts(); }
    renderCard();
    refreshOverlay();
    listeners.forEach((fn) => { try { fn(sel ? { ...sel } : null); } catch (e) { console.error(e); } });
  }
  function blockRing(s0) {
    const L = editing();
    if (!L || !s0) return null;
    if (s0.kind === 'core') return L.core;
    if (s0.kind === 'stair') { const b = L.stairs.find((x) => x.id === s0.id); return b ? b.outer : null; }
    if (s0.kind === 'support') { const b = L.support.find((x) => x.id === s0.id); return b ? b.outer : null; }
    return null;
  }
  function selRing() {
    if (!sel) return null;
    if (sel.kind === 'unit') { const u = unitAt(sel.k); return u ? u.outer : null; }
    if (sel.kind === 'free') { const f = freeSel(); return f ? stretchRing(f) : null; }
    if (sel.kind === 'corner') { const z = zoneById(sel.id); return z ? z.outer : null; }
    return blockRing(sel);
  }
  /** Re-reads the selection after the layout changed: a unit by its id, a stretch by its run and middle, a zone by its id. */
  function sanitize() {
    if (!sel) return false;
    if (sel.kind === 'unit') {
      const L = editing();
      const k = L && sel.uid ? L.units.findIndex((u) => u.uid === sel.uid) : -1;
      if (k >= 0) { if (k !== sel.k) { sel = { ...sel, k, id: String(k) }; } return false; }
      sel = null; onChanged(); return true;
    }
    if (sel.kind === 'free') {
      const lay = layout();
      const f = lay ? (lay.free || []).find((x) => x.runId === sel.runId && sel.mid >= x.a - 0.02 && sel.mid <= x.b + 0.02) : null;
      if (f) { if (f.id !== sel.id) sel = { ...sel, id: f.id }; return false; }
      sel = null; onChanged(); return true;
    }
    if (!selRing()) { sel = null; onChanged(); return true; }
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
  /** Grid snap (view.snap). Alt skips it. */
  function snapPoint(p, { skip = false } = {}) {
    const sn = Store.raw().view.snap;
    if (skip || !sn.on) return { x: p[0], y: p[1], kind: 'free' };
    const g = sn.grid || 0.5;
    return { x: Math.round(p[0] / g) * g, y: Math.round(p[1] / g) * g, kind: 'grid' };
  }
  const snapAt = (cx, cy, alt) => { const p = planAt(cx, cy); return p ? snapPoint(p, { skip: alt }) : null; };
  const snapOn = (alt) => !alt && Store.raw().view.snap.on !== false;

  /* ---- finding what is under a point ------------------------------------------------------------------------------ */
  const isUserSupport = (id) => (Store.raw().support || []).some((b) => b.id === id);
  /** The empty corner zone or the open stretch under a plan point: { kind: 'corner', zone } | { kind: 'run', run, s, stretch } | null. */
  function openAt(p, { leftovers = false } = {}) {
    const lay = layout();
    if (!lay) return null;
    for (const z of lay.cornerZones || []) if (pointInRing(p[0], p[1], z.outer)) return { kind: 'corner', zone: z };
    for (const r of lay.runs || []) {
      if (!inMP(r.band, p[0], p[1])) continue;
      const s = runS(r, p);
      const st = (lay.free || []).find((f) => f.runId === r.id && s >= f.a - 0.01 && s <= f.b + 0.01);
      if (st) return { kind: 'run', run: r, s, stretch: st };
    }
    // a leftover piece (Paint only): its run, as one open stretch
    if (leftovers) {
      for (const r of lay.leftoverRuns || []) {
        if (!inMP(r.band, p[0], p[1])) continue;
        const b = (lay.support || []).find((x) => x.kind === 'leftover' && x.run === r.id) || null;
        return { kind: 'run', run: r, s: runS(r, p), stretch: r.stretch, leftover: b ? b.id : null };
      }
    }
    return null;
  }
  function pickAt(cx, cy) {
    if (!ready || Render.comparing()) return null;
    const p = planAt(cx, cy);
    const L = editing();
    if (!p || !L) return null;
    const x = p[0], y = p[1];
    for (const b of L.support) if (pointInRing(x, y, b.outer) && b.kind !== 'pocket' && b.userBlock !== false && isUserSupport(b.id)) return { kind: 'support', id: b.id };
    const roomIds = new Set((L.coreRooms || []).map((r) => r.id));
    for (const s of L.stairs) if (!roomIds.has(s.id) && pointInRing(x, y, s.outer)) return { kind: 'stair', id: s.id };      // the stairs of an auto core are part of the core
    for (const e of L.elevators) if (pointInRing(x, y, e.outer)) return { kind: 'core', id: 'core' };
    if (L.core && pointInRing(x, y, L.core)) return { kind: 'core', id: 'core' };
    for (let k = 0; k < L.units.length; k++) if (pointInRing(x, y, L.units[k].outer)) return { kind: 'unit', id: String(k), k, uid: L.units[k].uid };
    const o = openAt(p);
    if (o && o.kind === 'corner') return { kind: 'corner', id: o.zone.id };
    if (o && o.kind === 'run') return { kind: 'free', id: o.stretch.id, runId: o.run.id, mid: (o.stretch.a + o.stretch.b) / 2 };
    for (const b of L.support) if (pointInRing(x, y, b.outer)) return { kind: 'support', id: b.id };
    return null;
  }

  /* ---- overlay: selection outline, handles, ghosts, previews ------------------------------------------------------- */
  const cssColorOf = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  function circleTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.lineWidth = 10; c.strokeStyle = '#23508f'; c.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function initOverlay() {
    group = new THREE.Group();
    Render.overlayGroup().add(group);
    ghostGroup = new THREE.Group();
    Render.overlayGroup().add(ghostGroup);
    previewGroup = new THREE.Group();
    Render.overlayGroup().add(previewGroup);
    dotTexture = circleTexture();
  }
  function clearGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    }
  }
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
  /** A flat translucent fill of a ring (a ghost, a paint preview). */
  function fillMesh(ring, color, opacity, z, order) {
    try {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], p[1]))), 1);
      geo.applyMatrix4(planMatrix(z));
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order; m.frustumCulled = false;
      return m;
    } catch (e) { return null; }
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
  /** The bay edges whose handles show: all draggable ones with the Bays toggle on, else the ones of the selected unit. */
  function visibleBays() {
    const s = Store.raw();
    if (draw || paint) return [];
    const all = dragBays();
    if (s.view.bays) return all;
    if (sel && sel.kind === 'unit') return all.filter((e) => e.a === sel.k || e.b === sel.k);
    return [];
  }
  /** The corner handles of the selected core: [x, y] for the corners SW, SE, NE, NW. */
  function coreHandles() {
    if (!sel || sel.kind !== 'core') return [];
    const r = rectOf(sel);
    return r ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : [];
  }
  let handles = [], cornerHandles = [];
  function refreshOverlay() {
    if (!ready || !group) return;
    clearGroup(group);
    handles = []; cornerHandles = [];
    if (Render.comparing() || draw) { Render.requestRender(); return; }
    const z = topZ() + 0.12;
    const ring = selRing();
    const accent = cssColorOf('--accent', '#23508f'), halo = cssColorOf('--surface', '#ffffff');
    if (ring) {
      const open = sel && (sel.kind === 'free' || sel.kind === 'corner');
      if (open) { const fm = fillMesh(ring, accent, 0.16, z - 0.04, 10); if (fm) group.add(fm); }
      const pos = ringPos(ring, z);
      const a = fatLine(pos, halo, 5.5, 0.85, 11, false), b = fatLine(pos, accent, 3, 1, 12, open);
      if (a) group.add(a); if (b) group.add(b);
    }
    handles = visibleBays().map((e) => ({ e, w: planToWorld(e.mid[0], e.mid[1], z) }));
    const bd = dots(handles.map((hh) => hh.w), COARSE ? 14 : 10);       // small drawn dot; the touch hit target stays 28 px (44 pt), so the dot never hides the plan
    if (bd) group.add(bd);
    cornerHandles = coreHandles().map((c, i) => ({ i, c, w: planToWorld(c[0], c[1], z) }));
    const cd = dots(cornerHandles.map((hh) => hh.w), COARSE ? 14 : 10);
    if (cd) group.add(cd);
    renderGhosts();
    Render.requestRender();
  }

  /* ---- the live label (area and type match) and the blank-plate hint ---------------------------------------------- */
  let live = null, hint = null;
  function ensureLive() {
    if (live) return live;
    live = h('div', { class: 'live-label', id: 'liveLabel', role: 'status', hidden: true });
    $('viewport').append(live);
    return live;
  }
  function showLive(text, cx, cy, bad = false) {
    const el = ensureLive(), vp = $('viewport').getBoundingClientRect();
    el.hidden = false;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('bad', !!bad);
    const w = el.offsetWidth || 160;
    const x = Math.min(Math.max(8, cx - vp.left + 16), Math.max(8, vp.width - w - 8)), y = Math.max(8, cy - vp.top - 40);
    el.style.left = `${x}px`; el.style.top = `${y}px`;
  }
  function hideLive() { if (live) live.hidden = true; }
  function syncHint() {
    if (!hint) return;
    const L = editing();
    hint.hidden = !(L && L.units.length === 0 && !draw && !paint && !Render.comparing() && !ghosts);
  }

  /* ---- paint (Paint tool) ------------------------------------------------------------------------------------------- */
  function paintResult(s1, alt) {
    const lay = layout();
    if (!lay || !paint) return null;
    if (paint.kind === 'corner') return DrawMod.cornerUnit(lay, Store.raw(), paint.zoneId);
    return DrawMod.paintUnit(layoutPlus(), Store.raw(), paint.runId, paint.s0, s1, { snap: snapOn(alt) });
  }
  function renderPaint(res, cx, cy) {
    if (!previewGroup) return;
    clearGroup(previewGroup);
    if (!res) { hideLive(); Render.requestRender(); return; }
    const z = topZ() + 0.3;
    const accent = cssColorOf('--accent', '#23508f');
    if (res.unit) {
      const col = new THREE.Color(typeColor(res.unit.type));
      const f = fillMesh(res.unit.outer, col, 0.45, z - 0.05, 9); if (f) previewGroup.add(f);
      const l = fatLine(ringPos(res.unit.outer, z), accent, 3, 1, 12, false); if (l) previewGroup.add(l);
      showLive(matchLine(res.area, res.unit.type, res.match, res.width), cx, cy, res.match !== 'in-range' ? false : false);
    } else showLive(res.message || 'This unit cannot go here.', cx, cy, true);
    Render.requestRender();
  }
  function startPaint(target, e, p) {
    const base = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, target };
    if (target.kind === 'corner') paint = { ...base, kind: 'corner', zoneId: target.zone.id };
    else paint = { ...base, kind: 'run', runId: target.run.id, s0: target.s, stretchId: target.stretch.id, leftover: target.leftover || null };
    try { Render.canvas().setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
    Render.setOrbitEnabled(false);
    syncHint();
  }
  function endPaint() {
    paint = null;
    hideLive();
    if (previewGroup) clearGroup(previewGroup);
    Render.setOrbitEnabled(true);
    Render.requestRender();
    syncHint();
  }
  function cancelPaint() { if (!paint) return false; try { Render.canvas().releasePointerCapture(paint.pointerId); } catch (err) { /* ignore */ } endPaint(); return true; }
  /** Adds a unit made by paintUnit, cornerUnit, freeUnit or a ghost. → the new unit's id */
  function addUnit(made) {
    const list = unitsNow();
    const su = DrawMod.toStateUnit(made, list);
    if (list.length >= CONFIG.limits.maxUnits) { Toast.show(`The limit is ${CONFIG.limits.maxUnits} units.`, 'warn'); return null; }
    writeUnits([...list, su]);
    const L = editing();
    const k = L ? L.units.findIndex((u) => u.uid === su.id) : -1;
    if (k >= 0) setSel({ kind: 'unit', id: String(k), k, uid: su.id });
    return su.id;
  }
  /** Logical paint (the pointer path ends here): a unit on `runId` from s0 to s1 (ft from the run start). */
  function paintOnRun(runId, s0, s1, { snap = true } = {}) {
    const lay = layoutPlus();
    if (!lay) return { unit: null, refused: 'no-layout', message: 'The plate has no layout.' };
    const res = DrawMod.paintUnit(lay, Store.raw(), runId, s0, s1, { snap });
    if (!res.unit) { Toast.show(res.message || 'The unit did not fit there.', 'warn', 4000); return res; }
    const id = addUnit(res.unit);
    return { ...res, id };
  }
  function paintCorner(zoneId) {
    const lay = layout();
    if (!lay) return { unit: null, refused: 'no-layout' };
    const res = DrawMod.cornerUnit(lay, Store.raw(), zoneId);
    if (!res.unit) { Toast.show(res.message || 'This corner zone has a unit.', 'warn', 4000); return res; }
    return { ...res, id: addUnit(res.unit) };
  }
  function finishPaint(e) {
    const pn = paint;
    if (!pn || e.pointerId !== pn.pointerId) return false;
    try { Render.canvas().releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const moved = Math.hypot(e.clientX - pn.x, e.clientY - pn.y) > PICK_PX;
    let res = null;
    if (moved) { const p = planAt(e.clientX, e.clientY); res = pn.kind === 'corner' ? { corner: true } : p ? { s1: runS(runById(pn.runId), p) } : null; }
    endPaint();
    if (!moved || !res) {                                                 // a tap: select the open stretch or the corner zone
      if (pn.kind === 'corner') setSel({ kind: 'corner', id: pn.zoneId });
      else if (pn.leftover) setSel({ kind: 'support', id: pn.leftover });
      else { const f = freeById(pn.stretchId); if (f) setSel({ kind: 'free', id: f.id, runId: f.runId, mid: (f.a + f.b) / 2 }); }
      return true;
    }
    if (pn.kind === 'corner') paintCorner(pn.zoneId);
    else paintOnRun(pn.runId, pn.s0, res.s1, { snap: snapOn(e.altKey) });
    return true;
  }

  /* ---- suggestions (ghost units) ------------------------------------------------------------------------------------ */
  function renderGhosts() {
    if (!ghostGroup) return;
    clearGroup(ghostGroup);
    if (!ghosts || !ghosts.list.length || draw) { Render.requestRender(); syncHint(); return; }
    const z = topZ() + 0.2;
    const ub = D().bounds.union, unit = clamp(Math.max(ub.maxX - ub.minX, ub.maxY - ub.minY) / 300, 1, 2.2);
    for (const g of ghosts.list) {
      const col = new THREE.Color(typeColor(g.type));
      const f = fillMesh(g.outer, col, 0.38, z - 0.04, 9); if (f) { f.userData.ghost = g.gid; ghostGroup.add(f); }
      const l = fatLine(ringPos(g.outer, z), col, 2.6, 1, 12, true); if (l) { l.userData.ghost = g.gid; ghostGroup.add(l); }
      const c = ringCentroidXY(g.outer);
      const lab = Overlays.label(`${typeName(g.type)}\n${Math.round(g.area).toLocaleString('en-US')} sf`, c[0], c[1], z + 0.05, { height: 2.3 * unit, color: g.match === 'large' ? '#a85600' : g.match === 'small' ? '#1f55a8' : '#1d2733' });
      lab.userData.ghost = g.gid;
      ghostGroup.add(lab);
    }
    Render.requestRender();
    syncHint();
  }
  /** Makes the ghosts for the selected open stretch or corner zone. → { ok, count, note } */
  function suggest() {
    const lay = layout();
    if (!lay || !sel) return { ok: false, count: 0, note: 'Select an open stretch or a corner zone first.' };
    let list = [], note = null;
    try {
      if (sel.kind === 'free') {
        const f = freeSel();
        if (!f) return { ok: false, count: 0, note: 'Select an open stretch first.' };
        const r = SuggestMod.suggestRun(lay, Store.raw(), f, {});
        list = r.units; note = r.note;
      } else if (sel.kind === 'corner') {
        const z = zoneById(sel.id);
        if (!z) return { ok: false, count: 0, note: 'Select a corner zone first.' };
        list = [SuggestMod.suggestCorner(lay, Store.raw(), z)];
      } else if (sel.kind === 'support' && leftoverOf(sel.id)) {
        const r = leftoverRunOf(leftoverOf(sel.id));
        if (!r) return { ok: false, count: 0, note: 'This leftover has no side to place units along.' };
        const res = SuggestMod.suggestRun(layoutPlus(), Store.raw(), r.stretch, {});
        list = res.units; note = res.note;
      } else return { ok: false, count: 0, note: 'Select an open stretch or a corner zone first.' };
    } catch (e) { console.error(e); return { ok: false, count: 0, note: 'The tool could not make a suggestion here.' }; }
    ghosts = { forKind: sel.kind, forId: sel.id, list: list.map((g, i) => ({ ...g, gid: `g${i + 1}` })), note };
    if (note) Toast.show(note, list.length ? '' : 'warn', 6000);
    renderGhosts();
    renderCard();
    return { ok: !!list.length, count: list.length, note };
  }
  function dismissGhosts() {
    if (!ghosts) return false;
    ghosts = null;
    renderGhosts(); renderCard();
    return true;
  }
  /** Accepts every ghost in one write (one undo step), or the one with the id `gid`. */
  function acceptGhosts(gid = null) {
    if (!ghosts || !ghosts.list.length) return { ok: false, count: 0 };
    const take = gid ? ghosts.list.filter((g) => g.gid === gid) : ghosts.list.slice();
    if (!take.length) return { ok: false, count: 0 };
    let cur = unitsNow().slice();
    if (cur.length + take.length > CONFIG.limits.maxUnits) { Toast.show(`The limit is ${CONFIG.limits.maxUnits} units.`, 'warn'); return { ok: false, count: 0 }; }
    const made = [];
    for (const g of take) { const su = DrawMod.toStateUnit(g, cur); cur = [...cur, su]; made.push(su.id); }
    const rest = ghosts.list.filter((g) => !take.includes(g));
    internal++;
    try { writeUnits(cur); } finally { internal--; }
    if (rest.length && gid) { ghosts = { ...ghosts, list: rest }; }
    else ghosts = null;
    const L = editing();
    const k = L ? L.units.findIndex((u) => u.uid === made[made.length - 1]) : -1;
    if (k >= 0 && !(ghosts && ghosts.list.length)) setSel({ kind: 'unit', id: String(k), k, uid: made[made.length - 1] });
    else { sanitize(); renderGhosts(); renderCard(); refreshOverlay(); }
    return { ok: true, count: made.length, ids: made };
  }
  const ghostAt = (p) => (ghosts ? ghosts.list.find((g) => pointInRing(p[0], p[1], g.outer)) || null : null);

  /* ---- drawing: a polygon plate, a block, a free unit ----------------------------------------------------------------- */
  const DRAWS = {
    polygon: { word: 'plate outline', min: 3, closed: true },
    rect: { word: 'block', min: 2, max: 2, closed: false },
    freeRect: { word: 'unit', min: 2, max: 2, closed: false },
    freePoly: { word: 'unit', min: 3, closed: true },
  };
  const isFreeDraw = (k) => k === 'freeRect' || k === 'freePoly';
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
    $('drawText').textContent = draw.kind === 'freeRect'
      ? (n < 1 ? 'Draw a unit: press at one corner and drag, or tap the first corner.' : 'Draw a unit: tap the opposite corner.')
      : draw.kind === 'freePoly'
      ? (n < 1 ? 'Draw a unit: tap the first point.' : `Draw a unit: ${n} point${n === 1 ? '' : 's'}. Tap the first point or press Enter to finish. Esc cancels.`)
      : draw.kind === 'rect'
      ? (n < 1 ? `Add ${draw.label || 'a block'}: tap the first corner.` : `Add ${draw.label || 'a block'}: tap the opposite corner.`)
      : (n < 1 ? 'Draw the plate outline: tap the first point.' : `Drawing the plate outline: ${n} point${n === 1 ? '' : 's'}. Tap the first point or press Enter to finish. Esc cancels.`);
    $('drawFinish').disabled = n < k.min;
  }
  function startDraw(kind, opts = {}) {
    if (!ready || !DRAWS[kind]) return false;
    if (Render.comparing()) { Toast.show('Leave Compare to draw.', 'warn'); return false; }
    cancelPaint();
    if (!opts.persist) clearSelOnly();
    ghosts = null; renderGhosts();
    draw = { kind, pts: [], target: opts.target || null, label: opts.label || null, persist: !!opts.persist };
    hover = null;
    if (Render.info().preset !== 'plan') Render.setView('plan', true);
    syncDrawBar();
    renderPreview();
    refreshOverlay();
    syncHint();
    const c = Render.canvas();
    if (c) c.classList.add('is-drawing');
    return true;
  }
  const clearSelOnly = () => { if (sel) setSel(null); };
  function endDraw() {
    draw = null; hover = null;
    syncDrawBar();
    hideLive();
    if (previewGroup) clearGroup(previewGroup);
    const c = Render.canvas();
    if (c) c.classList.remove('is-drawing');
    Render.requestRender();
    syncHint();
  }
  /** Ends the draw. A free-draw tool arms itself again, so the next shape can start at once. */
  function afterDraw(persist, kind) {
    endDraw();
    if (persist && (tool === 'rect' || tool === 'poly') && DRAWS[kind]) startDraw(kind, { persist: true });
    else refreshOverlay();
  }
  function cancelDraw() {
    if (!draw) return false;
    const { persist, kind, pts } = draw;
    if (persist && pts.length === 0) { setTool('select'); return true; }       // Escape with nothing drawn leaves the free-draw tool
    afterDraw(persist, kind);
    return true;
  }
  /** The ring of the shape being drawn (with the pointer as the last point), or null. */
  function drawRing(extra) {
    if (!draw) return null;
    const pts = extra ? draw.pts.concat([extra]) : draw.pts;
    if (draw.kind === 'freeRect') return pts.length === 2 ? rectRing([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]) : null;
    if (draw.kind === 'freePoly') return pts.length >= 3 ? pts : null;
    return null;
  }
  /** The live label of a free shape: the area and the type match of the clipped result. */
  function liveFree(cx, cy, extra) {
    const lay = layout(), ring = drawRing(extra);
    if (!lay || !ring || Math.abs(ringArea(ring)) < 1e-6) { hideLive(); return null; }
    const res = DrawMod.freeUnit(lay, Store.raw(), ring);
    if (res.unit) showLive(`${matchLine(res.area, res.unit.type, res.match)}${res.clipped ? ' (clipped to the unit zone)' : ''}`, cx, cy);
    else showLive(res.message || 'This shape makes no unit.', cx, cy, true);
    return res;
  }
  function renderPreview(res = null) {
    if (!previewGroup) return;
    clearGroup(previewGroup);
    if (!draw) return;
    const z = topZ() + 0.3;
    const accent = cssColorOf('--accent', '#23508f');
    const pts = hover ? draw.pts.concat([[hover.x, hover.y]]) : draw.pts;
    if (draw.kind === 'freeRect' && pts.length === 2) {
      const l = fatLine(ringPos(drawRing(pts[1]) ? drawRing(pts[1]).length ? rectRing([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]) : [] : [], z), accent, 3, 1, 12, true);
      if (l) previewGroup.add(l);
    } else if (draw.kind === 'rect' && pts.length === 2) {
      const r = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
      const l = fatLine(ringPos(rectRing(r), z), accent, 3, 1, 12, true);
      if (l) previewGroup.add(l);
    } else if ((draw.kind === 'polygon' || draw.kind === 'freePoly') && pts.length >= 2) {
      const l = fatLine(ringPos(pts, z, pts.length >= 3), accent, 3, 1, 12, true);
      if (l) previewGroup.add(l);
    }
    if (res && res.unit) {
      const f = fillMesh(res.unit.outer, new THREE.Color(typeColor(res.unit.type)), 0.4, z - 0.05, 9); if (f) previewGroup.add(f);
      if (res.clipped) { const l2 = fatLine(ringPos(res.unit.outer, z + 0.02), accent, 2, 1, 12, false); if (l2) previewGroup.add(l2); }
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
    if ((draw.kind === 'polygon' || draw.kind === 'freePoly') && draw.pts.length >= k.min && first && Math.hypot(first[0] - s.x, first[1] - s.y) <= tol) { finishDraw(); return true; }
    const last = draw.pts[draw.pts.length - 1];
    if (last && Math.hypot(last[0] - s.x, last[1] - s.y) <= tol) { if (draw.pts.length >= k.min) { finishDraw(); return true; } return false; }
    draw.pts.push([s.x, s.y]);
    hover = null;
    syncDrawBar();
    renderPreview();
    if (k.max && draw.pts.length >= k.max) finishDraw();
    return true;
  }
  /** Makes a free unit from a ring: clipped to the unit zone, refused under 50 sf. → { ok, ... } */
  function commitFree(ring) {
    const lay = layout();
    if (!lay) return { ok: false, refused: 'no-layout' };
    const res = DrawMod.freeUnit(lay, Store.raw(), ring);
    if (!res.unit) { Toast.show(res.message || 'This shape makes no unit.', 'warn', 5000); return { ok: false, ...res }; }
    const id = addUnit(res.unit);
    Toast.show(`Unit drawn: ${matchLine(res.area, res.unit.type, res.match)}.${res.clipped ? ' The shape was clipped to the unit zone.' : ''}`);
    return { ok: true, id, ...res };
  }
  function finishDraw() {
    if (!draw) return null;
    const k = DRAWS[draw.kind], pts = draw.pts.map((p) => [rnd(p[0]), rnd(p[1])]);
    if (pts.length < k.min) { Toast.show(`A ${k.word} needs at least ${k.min} points.`, 'warn'); return null; }
    const kind = draw.kind, target = draw.target, persist = draw.persist;
    if (isFreeDraw(kind)) {
      const ring = kind === 'freeRect' ? rectRing([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]) : (ringArea(pts) < 0 ? pts.slice().reverse() : pts);
      afterDraw(persist, kind);
      const r = commitFree(ring);
      return r.ok ? { kind, ...r } : null;
    }
    endDraw();
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

  /* ---- leftovers (leftover fix): Fill with units, Make open stretch ---------------------------------------------------- */
  const openPath = () => {
    const s = Store.raw(), L = editing();
    if (s.source === 'project') return L && L.groupId ? `levels.groups.${L.groupId}.openLeftovers` : null;
    return 'openLeftovers';
  };
  /** A point inside a ring: its centroid, else the middle of the run base moved a little into the piece. */
  function insidePoint(b, run) {
    const c = ringCentroidXY(b.outer);
    if (pointInRing(c[0], c[1], b.outer)) return c;
    for (const f of [0.5, 0.25, 0.75]) for (const t of [0.5, 1, 2, 4]) { const p = runPoint(run, run.length * f, Math.min(t, run.depth / 2)); if (pointInRing(p[0], p[1], b.outer)) return p; }
    return c;
  }
  /** Make open stretch: the leftover becomes an open stretch (a seed point in openLeftovers; one undo step) and is selected. */
  function openLeftover(id = sel && sel.kind === 'support' ? sel.id : null) {
    const b = leftoverOf(id), run = leftoverRunOf(b), p = openPath();
    if (!b || !run || !p) { Toast.show('This leftover has no side to place units along. Draw a unit in it with Rectangle or Polygon.', 'warn', 5000); return { ok: false }; }
    const seed = insidePoint(b, run).map(rnd3);
    const s = Store.raw(), L = editing();
    internal++;
    try {
      if (s.source === 'project' && !(s.levels.groups && s.levels.groups[L.groupId])) Store.set(`levels.groups.${L.groupId}`, { filled: true, units: [], openLeftovers: [seed] }, { live: false });
      else { const cur = Store.get(p); Store.set(p, [...(Array.isArray(cur) ? cur : []), seed], { live: false }); }
    } finally { internal--; }
    const lay = layout();
    const f = lay ? (lay.free || []).find((x) => x.runId === run.id) : null;
    if (f) setSel({ kind: 'free', id: f.id, runId: f.runId, mid: (f.a + f.b) / 2 });
    else clear();
    return { ok: !!f, runId: run.id, stretch: f ? f.id : null };
  }
  /** Fill with units: the suggestion on the leftover's run (ghosts; Accept all makes the units and opens the piece). */
  function fillLeftover(id = sel && sel.kind === 'support' ? sel.id : null) {
    if (!leftoverOf(id)) return { ok: false, count: 0, note: 'Select a leftover first.' };
    if (!(sel && sel.kind === 'support' && sel.id === id)) setSel({ kind: 'support', id });
    return suggest();
  }

  /* ---- editing blocks and the core ------------------------------------------------------------------------------------- */
  function rectOf(it) {
    const s = Store.raw();
    if (it.kind === 'core') { const r = s.core.mode === 'manual' && s.core.rect; if (r) return r.slice(); const L = editing(); return L && L.core ? ringRect(L.core).map(rnd3) : null; }
    if (it.kind === 'support') { const b = s.support.find((x) => x.id === it.id); return b ? b.rect.slice() : null; }
    if (it.kind === 'stair') { const m = manualStairs().find((x) => x.id === it.id); return m ? m.rect : null; }
    return null;
  }
  /** Moves a block to `rect`. A core move sets the core to Manual. */
  function setBlockRect(it, rect, live = false) {
    const s = Store.raw();
    const r = rect.map(rnd3);
    if (it.kind === 'core') return setCoreRect(r, live);
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
  function deleteBlock(it) {
    const s = Store.raw();
    if (!it) return false;
    if (it.kind === 'support') {
      if (!isUserSupport(it.id)) { Toast.show('This block comes from the plate. Edit the hotel back-of-house to remove it.', 'warn', 5000); return false; }
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
  /** Resizes the core by moving one corner (0 SW, 1 SE, 2 NE, 3 NW) to the point (x, y): 0.5 ft steps, 10 by 10 ft at least. → the new rectangle */
  function coreRectFor(rect0, corner, x, y, snap = true) {
    const q = (v) => (snap ? Math.round(v / CORE_STEP) * CORE_STEP : v);
    let [x0, y0, x1, y1] = rect0;
    const west = corner === 0 || corner === 3, south = corner === 0 || corner === 1;
    if (west) x0 = Math.min(q(x), x1 - CORE_MIN); else x1 = Math.max(q(x), x0 + CORE_MIN);
    if (south) y0 = Math.min(q(y), y1 - CORE_MIN); else y1 = Math.max(q(y), y0 + CORE_MIN);
    return [x0, y0, x1, y1];
  }
  function resizeCore(corner, x, y, live = false) {
    const r0 = rectOf({ kind: 'core', id: 'core' });
    if (!r0) return false;
    return setCoreRect(coreRectFor(r0, corner, x, y), live);
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
  /** "Reset core to auto": the manual rectangle goes and the plate makes the core again. */
  function resetCore() {
    const s = Store.raw();
    if (s.core.mode === 'auto' && !s.core.rect) return false;
    Store.set('core', { mode: 'auto', rect: null }, { live: false });
    if (sel && sel.kind === 'core') onChanged();
    return true;
  }
  /** The passenger elevator count: null is automatic. */
  function setElevators(n) {
    const v = n === null || n === undefined ? null : Math.max(0, Math.min(20, Math.round(n)));
    return Store.set('elevators.count', v, { live: false }), true;
  }

  /* ---- editing units ------------------------------------------------------------------------------------------------- */
  const reselect = (uid) => {
    const L = editing();
    const k = L && uid ? L.units.findIndex((u) => u.uid === uid) : -1;
    setSel(k >= 0 ? { kind: 'unit', id: String(k), k, uid } : null);
  };
  /** Sets the type of a unit by hand (typeSet). The outline stays. → { ok, type } */
  function setUnitType(k, typeId) {
    const u = unitAt(k);
    if (!u || !u.uid) return { ok: false, reason: 'no unit' };
    if (!typeOf(typeId)) return { ok: false, reason: 'no type' };
    const su = stateUnit(u.uid);
    if (!su) return { ok: false, reason: 'no unit' };
    const next = DrawMod.retype(su, typeId);
    writeUnits(unitsNow().map((x) => (x.id === su.id ? next : x)));
    reselect(u.uid);
    return { ok: true, type: typeId };
  }
  function deleteUnit(k = sel && sel.kind === 'unit' ? sel.k : -1) {
    const u = unitAt(k);
    if (!u || !u.uid) return false;
    writeUnits(unitsNow().filter((x) => x.id !== u.uid));
    clear();
    return true;
  }
  /** Split a unit in two at its middle (draw.js splitUnit). → { ok } | { ok: false, reason, message } */
  function splitUnit(k = sel && sel.kind === 'unit' ? sel.k : -1, at = null) {
    const lay = layout(), u = unitAt(k);
    if (!lay || !u || !u.uid) return { ok: false, reason: 'no unit' };
    const r = DrawMod.splitUnit(lay, u.uid, at, Store.raw());
    if (!r.units) return { ok: false, reason: r.refused, message: r.message };
    const [a, b] = r.units;
    writeUnits(unitsNow().flatMap((x) => (x.id === a.id ? [a, b] : [x])));
    reselect(a.id);
    return { ok: true, ids: [a.id, b.id], types: [a.type, b.type] };
  }
  /** The neighbors of a unit across a bay line: the uids of the unit on the left and on the right (-1 and 1). */
  function neighborsOf(k) {
    const L = editing(), u = unitAt(k);
    if (!L || !u) return { '-1': null, '1': null };
    const run = u.runId ? runById(u.runId) : null;
    const t = run ? run.u : [1, 0];
    const key = (c) => (Math.abs(t[0]) >= Math.abs(t[1]) ? t[0] * c[0] : -t[1] * c[1]) * (Math.abs(t[0]) >= Math.abs(t[1]) ? Math.sign(t[0]) || 1 : 1);
    const me = key(ringCentroidXY(u.outer));
    const out = { '-1': null, '1': null };
    const best = {};
    for (const e of bayEdges()) {
      if (e.a !== k && e.b !== k) continue;
      const j = e.a === k ? e.b : e.a, v = L.units[j];
      const dk = key(ringCentroidXY(v.outer)) - me;
      const dir = dk < 0 ? -1 : 1;
      if (best[dir] === undefined || Math.abs(dk) < best[dir]) { best[dir] = Math.abs(dk); out[String(dir)] = v.uid; }
    }
    return out;
  }
  /** Merge the unit with its neighbor on one side (dir -1 = left, 1 = right). → { ok } | { ok: false, reason, message } */
  function mergeUnit(dir, k = sel && sel.kind === 'unit' ? sel.k : -1) {
    const lay = layout(), u = unitAt(k);
    if (!lay || !u || !u.uid) return { ok: false, reason: 'no unit' };
    const other = neighborsOf(k)[String(dir)];
    if (!other) return { ok: false, reason: 'no neighbor' };
    const r = DrawMod.mergeUnits(lay, u.uid, other, Store.raw());
    if (!r.unit) return { ok: false, reason: r.refused, message: r.message };
    const keepId = r.unit.id;
    writeUnits(unitsNow().filter((x) => x.id === keepId || (x.id !== u.uid && x.id !== other)).map((x) => (x.id === keepId ? r.unit : x)));
    reselect(keepId);
    return { ok: true, id: keepId, type: r.unit.type };
  }
  /** Clear level: removes every drawn unit of the editing level (the selected group of a project). One undo step. */
  function clearLevelNow() {
    const n = unitsNow().length;
    if (!n) { Toast.show('This level has no units to clear.', 'warn'); return 0; }
    dismissGhosts();
    writeUnits([]);
    clear();
    return n;
  }
  async function clearLevel({ confirm = true } = {}) {
    const n = unitsNow().length;
    if (!n) { Toast.show('This level has no units to clear.', 'warn'); return false; }
    const project = Store.raw().source === 'project';
    if (confirm) {
      const ok = await confirmDialog(`Remove all ${n} unit${n === 1 ? '' : 's'} of this ${project ? 'level group' : 'level'}? Undo brings them back.`, 'Clear level', true);
      if (!ok) return false;
    }
    return clearLevelNow() > 0;
  }

  /* ---- bay lines (Select) -------------------------------------------------------------------------------------------- */
  /** Writes the two units that moveBayLine made (live during a drag). → the result, or null when refused */
  function moveBayTo(e, s, live = false, snap = true) {
    const lay = layout();
    if (!lay || !e || !e.run) return null;
    const r = DrawMod.moveBayLine(lay, Store.raw(), e.uidA, e.uidB, s, { snap });
    if (!r.units) return null;
    const ids = new Set(r.units.map((u) => u.id));
    writeUnits(unitsNow().map((x) => (ids.has(x.id) ? r.units.find((u) => u.id === x.id) : x)), live);
    return r;
  }
  let widthLabel = null;
  function clearBayWidths() {
    if (widthLabel && previewGroup) { previewGroup.remove(widthLabel); if (widthLabel.geometry) widthLabel.geometry.dispose(); if (widthLabel.material) { if (widthLabel.material.map) widthLabel.material.map.dispose(); widthLabel.material.dispose(); } }
    widthLabel = null;
    Render.requestRender();
  }
  function showBayWidths(e, r) {
    if (!previewGroup || !r) return;
    clearBayWidths();
    const run = runById(e.run);
    const ub = D().bounds.union, unit = clamp(Math.max(ub.maxX - ub.minX, ub.maxY - ub.minY) / 300, 1, 2.2);
    const p = runPoint(run, r.s, (run.depth || 28) * 0.62);
    const sc = (u) => runS(run, ringCentroidXY(u.outer));
    const ws = r.units && r.units.length === 2 && sc(r.units[0]) > sc(r.units[1]) ? [r.widths[1], r.widths[0]] : r.widths;
    widthLabel = Overlays.label(`${fmt(ws[0])}  |  ${fmt(ws[1])}`, p[0], p[1], topZ() + 0.35, { height: 2.4 * unit, color: '#1d2733' });
    widthLabel.userData.bayWidths = true;
    previewGroup.add(widthLabel);
    Render.requestRender();
  }

  /* ---- tools -------------------------------------------------------------------------------------------------------------- */
  const TOOL_LIST = [
    { id: 'paint', label: 'Paint', key: 'P', title: 'Paint: press on an open stretch of a run and drag along it to draw a unit (P)' },
    { id: 'suggest', label: 'Suggest', key: 'S', title: 'Suggest: tap an open stretch or an empty corner zone to see a layout (S)' },
    { id: 'rect', label: 'Rectangle', key: 'R', title: 'Free draw, rectangle: two corners (R)' },
    { id: 'poly', label: 'Polygon', key: 'G', title: 'Free draw, polygon: tap the points (G)' },
    { id: 'select', label: 'Select', key: 'V', title: 'Select: tap a unit, the core or a block to edit it (V)' },
  ];
  function setTool(next) {
    if (!TOOL_LIST.some((t) => t.id === next)) return false;
    if (Render.comparing()) { Toast.show('Leave Compare to draw.', 'warn'); return false; }
    if (draw && !(next === 'rect' || next === 'poly')) { const d0 = draw; if (d0.persist) endDraw(); else cancelDraw(); }
    cancelPaint();
    const prev = tool;
    tool = next;
    if (next !== 'paint' && next !== 'suggest') { if (ghosts) { ghosts = null; renderGhosts(); renderCard(); } }
    if (next === 'rect' || next === 'poly') {
      if (draw) endDraw();
      startDraw(next === 'rect' ? 'freeRect' : 'freePoly', { persist: true });
    }
    const c = Render.canvas();
    if (c) c.dataset.tool = tool;
    toolListeners.forEach((fn) => { try { fn(tool, prev); } catch (e) { console.error(e); } });
    syncHint();
    return true;
  }
  function buildTools() {
    if ($('tools')) return;
    const ICON = {
      paint: '<svg viewBox="0 0 24 24"><path d="M4 18h16"/><path d="M6 14l9-9 3 3-9 9H6z"/></svg>',
      suggest: '<svg viewBox="0 0 24 24"><path d="M4 9h6v8H4zM14 9h6v8h-6z" stroke-dasharray="2.5 2"/><path d="M12 3v3M7 4.5l1.2 1.6M17 4.5l-1.2 1.6"/></svg>',
      rect: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
      poly: '<svg viewBox="0 0 24 24"><path d="M5 17l2-10 8-2 4 8-6 6z"/></svg>',
      select: '<svg viewBox="0 0 24 24"><path d="M6 4l12 7-5 1.5L11 18z"/></svg>',
      core: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/><path d="M5 12h14M12 5v14"/></svg>',
      clear: '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>',
    };
    const btn = (id, label, key, title, onclick) => h('button', { class: 'tool', type: 'button', 'data-tool': id, 'aria-pressed': 'false', title, 'aria-label': label, onclick },
      h('span', { class: 'tool-ic', html: ICON[id] }), h('span', { class: 'tool-tx' }, label), key ? h('kbd', null, key) : null);
    const nav = h('nav', { class: 'tools', id: 'tools', 'aria-label': 'Drawing tools' },
      ...TOOL_LIST.map((t) => btn(t.id, t.label, t.key, t.title, () => setTool(t.id))),
      h('span', { class: 'tool-sep' }),
      h('button', { class: 'tool', type: 'button', 'data-action': 'core', title: 'Select the core', 'aria-label': 'Core', onclick: () => selectCore() }, h('span', { class: 'tool-ic', html: ICON.core }), h('span', { class: 'tool-tx' }, 'Core')),
      h('button', { class: 'tool', type: 'button', 'data-action': 'clear', title: 'Clear level: remove every unit of this level', 'aria-label': 'Clear level', onclick: () => { clearLevel(); } }, h('span', { class: 'tool-ic', html: ICON.clear }), h('span', { class: 'tool-tx' }, 'Clear level')));
    $('viewport').append(nav);
    const sync = () => nav.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    toolListeners.push(sync);
    sync();
    hint = h('div', { class: 'blank-hint', id: 'blankHint', role: 'note', hidden: true }, 'Drag along a facade to draw a unit. Select an open stretch and tap Suggest for a layout.');
    $('viewport').append(hint);
  }
  function selectCore() {
    if (draw) cancelDraw();
    if (tool !== 'select') setTool('select');
    const L = editing();
    if (!L || !L.core) { Toast.show('This plate has no core block. Set the core mode to Auto or Manual in the Plate tab.', 'warn', 5000); return false; }
    return setSel({ kind: 'core', id: 'core' }), true;
  }

  /* ---- pointer handling ------------------------------------------------------------------------------------------------ */
  const downs = new Map();
  function bayHit(cx, cy, touch) {
    if (draw || paint) return null;
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
    for (const hh of handles) {
      const e = hh.e;
      const a = screenOf(e.p[0], e.p[1]), b = screenOf(e.q[0], e.q[1]);
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
      const tt = clamp(((cx - a.x) * vx + (cy - a.y) * vy) / L2, 0, 1);
      const dd = Math.hypot(cx - (a.x + vx * tt), cy - (a.y + vy * tt));
      if (dd <= rad * 0.6 && (!best || dd < best.d)) best = { e, d: dd };
    }
    return best;
  }
  function cornerHit(cx, cy, touch) {
    if (draw || paint) return null;
    const rad = touch ? BAY_PX_TOUCH : BAY_PX;
    let best = null;
    for (const hh of cornerHandles) {
      const p = toClient(new THREE.Vector3(...hh.w));
      const dd = Math.hypot(p.x - cx, p.y - cy);
      if (dd <= rad && (!best || dd < best.d)) best = { i: hh.i, d: dd };
    }
    return best;
  }
  const grab = (e) => { e.preventDefault(); e.stopImmediatePropagation(); try { Render.canvas().setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ } Render.setOrbitEnabled(false); };
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (Render.comparing()) return;
    const touch = e.pointerType === 'touch';
    if (paint && e.pointerId !== paint.pointerId) { cancelPaint(); return; }       // a second finger: the page pans and zooms, nothing is drawn
    if (draw && draw.kind === 'freeRect' && draw.pts.length === 0) {                // press and drag a rectangle
      const s = snapAt(e.clientX, e.clientY, e.altKey);
      if (s) { grab(e); drag = { type: 'rect', pointerId: e.pointerId, start: [s.x, s.y], x: e.clientX, y: e.clientY }; return; }
    }
    if (!draw) {
      const cm = cornerHit(e.clientX, e.clientY, touch);
      if (cm) {
        grab(e);
        drag = { type: 'corner', pointerId: e.pointerId, corner: cm.i, rect0: rectOf(sel), started: false };
        return;
      }
      const hit = bayHit(e.clientX, e.clientY, touch);
      if (hit) {
        grab(e);
        drag = { type: 'bay', pointerId: e.pointerId, e: hit.e, started: false, grabS: runS(runById(hit.e.run), planAt(e.clientX, e.clientY) || hit.e.mid) - hit.e.s };
        return;
      }
      if (sel && sel.kind !== 'unit' && sel.kind !== 'free' && sel.kind !== 'corner') {
        const p = planAt(e.clientX, e.clientY), ring = selRing();
        if (p && ring && pointInRing(p[0], p[1], ring)) {
          const rect = rectOf(sel);
          if (rect) { grab(e); drag = { type: 'block', pointerId: e.pointerId, it: { ...sel }, rect, start: p, started: false }; return; }
        }
      }
      if (tool === 'paint') {
        const p = planAt(e.clientX, e.clientY);
        const target = p && !ghostAt(p) ? openAt(p, { leftovers: true }) : null;
        if (target) { grab(e); startPaint(target, e, p); return; }
      }
    }
    for (const r of downs.values()) r.cancel = true;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), cancel: downs.size > 0 });
  }
  function onMove(e) {
    if (paint && e.pointerId === paint.pointerId) {
      if (Math.hypot(e.clientX - paint.x, e.clientY - paint.y) > PICK_PX) paint.moved = true;
      if (!paint.moved) return;
      const p = planAt(e.clientX, e.clientY);
      if (!p) return;
      renderPaint(paint.kind === 'corner' ? paintResult(0, e.altKey) : paintResult(runS(runById(paint.runId), p), e.altKey), e.clientX, e.clientY);
      return;
    }
    if (drag && e.pointerId === drag.pointerId) {
      const p = planAt(e.clientX, e.clientY);
      if (!p) return;
      if (drag.type === 'rect') {
        const s = snapPoint(p, { skip: e.altKey });
        hover = { x: s.x, y: s.y };
        const first = draw ? draw.pts : [];
        const saved = draw ? draw.pts : null;
        if (draw) draw.pts = [drag.start];
        const res = liveFree(e.clientX, e.clientY, [s.x, s.y]);
        renderPreview(res);
        if (draw) draw.pts = saved || first;
        return;
      }
      if (drag.type === 'bay') {
        const s = runS(runById(drag.e.run), p) - drag.grabS;
        if (!drag.started && Math.abs(s - drag.e.s) < 0.01) return;
        drag.started = true;
        const r = moveBayTo(drag.e, s, true, snapOn(e.altKey));
        if (r) showBayWidths(drag.e, r);
        return;
      }
      if (drag.type === 'corner') {
        const snap = !e.altKey;
        const rect = coreRectFor(drag.rect0, drag.corner, p[0], p[1], snap);
        if (!drag.started && rect.every((v, i) => Math.abs(v - drag.rect0[i]) < 1e-6)) return;
        drag.started = true;
        setCoreRect(rect, true);
        return;
      }
      if (drag.type === 'block') {
        let dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
        const q = (v) => (e.altKey ? v : Math.round(v / CORE_STEP) * CORE_STEP);
        if (drag.it.kind !== 'core') { const sn = Store.raw().view.snap; if (sn.on && !e.altKey) { const g = sn.grid || 0.5; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; } } else { dx = q(dx); dy = q(dy); }
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
      let res = null;
      if (isFreeDraw(draw.kind) && hover) res = liveFree(e.clientX, e.clientY, [hover.x, hover.y]);
      else hideLive();
      renderPreview(res);
    } else if (!draw && !r && e.pointerType === 'mouse' && tool === 'paint' && !drag && !paint) {
      const p = planAt(e.clientX, e.clientY);
      const c = Render.canvas();
      if (c) c.classList.toggle('can-paint', !!(p && openAt(p, { leftovers: true }) && !ghostAt(p)));
    }
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return false;
    try { Render.canvas().releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const was = drag.started, d0 = drag;
    drag = null;
    clearBayWidths();
    Render.setOrbitEnabled(true);
    if (d0.type === 'rect') {
      const moved = Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > PICK_PX;
      if (!draw) return true;
      const s = snapAt(e.clientX, e.clientY, e.altKey);
      if (moved && s) { draw.pts = [d0.start, [s.x, s.y]]; finishDraw(); }
      else { draw.pts = [d0.start]; hover = null; syncDrawBar(); renderPreview(); }
      return true;
    }
    if (was) {
      Store.commit();
      if (d0.type === 'bay') { const u = sel && sel.kind === 'unit' ? sel.uid : null; if (u) reselect(u); else sanitize(); }
      else sanitize();
    }
    return true;
  }
  function initPointer() {
    const canvas = Render.canvas();
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointercancel', (e) => { downs.delete(e.pointerId); if (paint && e.pointerId === paint.pointerId) cancelPaint(); endDrag(e); });
    canvas.addEventListener('pointerup', (e) => {
      if (paint && e.pointerId === paint.pointerId) { finishPaint(e); return; }
      if (endDrag(e)) return;
      const r = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      if (!r || r.cancel || downs.size) return;
      if (Math.hypot(e.clientX - r.x, e.clientY - r.y) > PICK_PX || performance.now() - r.t > PICK_MS) return;
      click(e.clientX, e.clientY, e.altKey);
    });
    canvas.addEventListener('pointerleave', () => { if (!paint && !draw) hideLive(); });
  }
  function click(cx, cy, alt = false) {
    if (draw) return addDrawPoint(cx, cy, alt);
    const p = planAt(cx, cy);
    if (p && ghosts) { const g = ghostAt(p); if (g) { acceptGhosts(g.gid); return { kind: 'ghost', id: g.gid }; } }
    const hit = pickAt(cx, cy);
    setSel(hit);
    if (hit && tool === 'suggest' && (hit.kind === 'free' || hit.kind === 'corner' || (hit.kind === 'support' && leftoverOf(hit.id)))) suggest();
    return hit;
  }

  /* ---- the selection card (#selection-card) ------------------------------------------------------------------------------ */
  let cardRefs = null;
  const BLOCK_WORDS = { core: 'Core', stair: 'Stair', support: 'Support block' };
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
  /** The text of a match for the card: "In range (650 to 800 sf)", "Large: above the 650 to 800 sf range of this type". */
  function matchText(u) {
    const t = typeOf(u.type);
    const r = t ? rangeText(t) : '';
    if (u.match === 'large') return `Large: above the ${r} range of this type.`;
    if (u.match === 'small') return `Small: below the ${r} range of this type.`;
    return t ? `In range (${r}).` : 'In range.';
  }
  function describeUnit(u) {
    const z = sizeOf(u);
    const rows = [
      ['Type', `${u.typeName}${u.typeSet ? ' (set by hand)' : ''}`],
      ['Area', sf(u.area)],
      ['Width x depth', `${fmt(z.w)} x ${fmt(z.d)}`],
      ['Match', matchText(u)],
      ['Exposures', u.exposures.length ? u.exposures.join(' ') : 'none'],
    ];
    if (u.corner) rows.push(['Corner', 'wrap unit']);
    if (u.accessible) rows.push(['Accessible', typeof u.accessible === 'string' ? u.accessible : 'yes']);
    if (u.clipped) rows.push(['Clipped', 'A block, the core or another unit cuts this unit. Its area is smaller than you drew.']);
    return { title: `Unit ${u.uid || u.id}`, sub: matchLine(u.area, u.type, u.match), rows };
  }
  function syncCardText() {
    if (!cardRefs || !sel) return;
    const L = editing();
    if (!L) return;
    let info = null;
    cardRefs.actions.textContent = '';
    cardRefs.types.textContent = '';
    cardRefs.types.hidden = true;
    const btn = (label, action, onclick, o = {}) => h('button', { class: `btn ${o.solid ? 'solid' : 'outline'} sm${o.danger ? ' danger-text' : ''}`, type: 'button', 'data-action': action, disabled: !!o.disabled, title: o.title || null, onclick }, label);
    const typeChips = (onPick, current) => {
      cardRefs.types.hidden = false;
      for (const t of mixList()) {
        cardRefs.types.append(h('button', { class: 'chip', type: 'button', 'data-type': t.id, 'aria-pressed': String(t.id === current), title: `${t.name}: ${rangeText(t)}`, onclick: () => onPick(t) },
          h('span', { class: 'sw', style: `background:${t.color}` }), t.name));
      }
    };
    if (sel.kind === 'unit') {
      const u = unitAt(sel.k);
      if (!u) return;
      info = describeUnit(u);
      typeChips((t) => setUnitType(sel.k, t.id), u.type);
      const nb = neighborsOf(sel.k);
      cardRefs.actions.append(
        btn('Split', 'split', () => { const r = splitUnit(); if (!r.ok) Toast.show(r.message || 'The unit does not split here.', 'warn', 4000); }, { title: 'Cut the unit into two units at its middle' }),
        btn('Merge ←', 'merge-left', () => { const r = mergeUnit(-1); if (!r.ok) Toast.show(r.message || 'These two units do not join into one piece.', 'warn', 4000); }, { disabled: !nb['-1'], title: 'Join this unit and the unit on its left' }),
        btn('Merge →', 'merge-right', () => { const r = mergeUnit(1); if (!r.ok) Toast.show(r.message || 'These two units do not join into one piece.', 'warn', 4000); }, { disabled: !nb['1'], title: 'Join this unit and the unit on its right' }),
        btn('Delete', 'delete', () => deleteUnit(), { danger: true, title: 'Remove this unit (Delete key)' }));
    } else if (sel.kind === 'free') {
      const f = freeSel();
      if (!f) return;
      const ring = stretchRing(f);
      info = { title: 'Open stretch', sub: `${fmt(f.length)} long, ${sf(ring ? Math.abs(ringArea(ring)) : 0)}`, rows: [['Length', fmt(f.length)], ['Depth', fmt(f.depth)], ['Next', 'Tap Suggest for a layout, or drag along the facade to draw a unit.']] };
      if (ghosts && ghosts.forId === sel.id) {
        if (ghosts.list.length) {
          info.rows.push(['Suggestion', ghosts.list.map((g) => `${typeName(g.type)} ${Math.round(g.area).toLocaleString('en-US')} sf`).join(', ')]);
          cardRefs.actions.append(btn('Accept all', 'accept-all', () => acceptGhosts(), { solid: true }), btn('Dismiss', 'dismiss', () => dismissGhosts()));
        } else {
          info.rows.push(['Suggestion', ghosts.note || 'No unit fits this stretch.']);
          cardRefs.actions.append(btn('Dismiss', 'dismiss', () => dismissGhosts()));
        }
      } else cardRefs.actions.append(btn('Suggest', 'suggest', () => suggest(), { solid: true }));
    } else if (sel.kind === 'corner') {
      const z = zoneById(sel.id);
      if (!z) return;
      const ct = (Store.raw().mix && Store.raw().mix.cornerType) || z.type;
      info = { title: 'Corner zone', sub: sf(Math.abs(ringArea(z.outer))), rows: [['Corner unit', typeName(ct)], ['Area', sf(Math.abs(ringArea(z.outer)))], ['Next', 'Tap Suggest, or add the corner unit. A drag that starts in the zone also adds it.']] };
      if (ghosts && ghosts.forId === sel.id && ghosts.list.length) cardRefs.actions.append(btn('Accept all', 'accept-all', () => acceptGhosts(), { solid: true }), btn('Dismiss', 'dismiss', () => dismissGhosts()));
      else cardRefs.actions.append(btn('Suggest', 'suggest', () => suggest(), { solid: true }), btn('Add corner unit', 'add-corner', () => paintCorner(sel.id)));
    } else {
      const r = rectOf(sel);
      const ring = selRing();
      const area = ring ? Math.abs(ringArea(ring)) : 0;
      let label = BLOCK_WORDS[sel.kind] || sel.kind;
      if (sel.kind === 'support') { const b = L.support.find((x) => x.id === sel.id); if (b) label = `${b.kind.charAt(0).toUpperCase()}${b.kind.slice(1)} block`; }
      info = { title: sel.kind === 'core' ? 'Core' : `${label} ${sel.id}`, sub: sf(area), rows: r ? [['Size', `${fmt(r[2] - r[0])} x ${fmt(r[3] - r[1])}`], ['Lower left', `${fmt(r[0])}, ${fmt(r[1])}`]] : [['Area', sf(area)]] };
      if (sel.kind === 'core') {
        const st = Store.raw(), cm = st.core.mode, prog = D().hud.core;
        const fits = L.coreFits === false ? false : !!(L.coreRooms && L.coreRooms.length > 0);
        info.rows.push(['Mode', { auto: 'Auto: the tool makes the core', manual: 'Manual: you set the rectangle', none: 'None' }[cm] || cm]);
        if (cm === 'manual') info.rows.push(['Rooms', fits ? 'Drawn inside the core.' : 'Rooms do not fit. The core stays one block.']);
        if (prog && prog.cabs !== null && prog.cabs !== undefined) info.rows.push(['Elevators', `${prog.cabs} passenger${prog.service ? `, ${prog.service} service` : ''}`]);
        info.rows.push(['Edit', 'Drag the core to move it. Drag a corner handle to resize it. The mode becomes Manual.']);
        const modes = h('div', { class: 'chips', role: 'group', 'aria-label': 'Core mode', id: 'coreModeCard' },
          ...CORE_MODES.map((m) => h('button', { class: 'chip', type: 'button', 'data-mode': m, 'aria-pressed': String(m === cm), onclick: () => setCoreMode(m) }, CORE_MODE_LABELS[m])));
        cardRefs.types.hidden = false;
        cardRefs.types.setAttribute('aria-label', 'Core mode');
        cardRefs.types.append(...modes.children);
        const n = st.elevators.count, autoN = prog && prog.autoCabs !== null && prog.autoCabs !== undefined ? prog.autoCabs : (prog ? prog.cabs : 2);
        const shown = n === null || n === undefined ? autoN : n;
        cardRefs.actions.append(
          btn('−', 'elev-minus', () => setElevators(Math.max(0, (shown || 0) - 1)), { title: 'One passenger elevator fewer', disabled: !(shown > 0) }),
          h('span', { class: 'sc-count', id: 'elevCount', title: 'Passenger elevators' }, `${shown} elevator${shown === 1 ? '' : 's'}${n === null || n === undefined ? ' (auto)' : ''}`),
          btn('+', 'elev-plus', () => setElevators((shown || 0) + 1), { title: 'One passenger elevator more' }),
          btn('Elevators: auto', 'elev-auto', () => setElevators(null), { disabled: n === null || n === undefined, title: 'Let the tool set the elevator count' }),
          btn('Reset core to auto', 'reset-core', () => resetCore(), { disabled: cm === 'auto' && !st.core.rect }));
      }
      if (sel.kind === 'stair' && Store.raw().stairs.mode !== 'manual') info.rows.push(['Mode', 'Moving it switches the stairs to Manual']);
      if (sel.kind === 'support' && !isUserSupport(sel.id)) info.rows.push(['Source', 'from the plate']);
      const lo = sel.kind === 'support' ? leftoverOf(sel.id) : null;
      if (lo) {
        const run = leftoverRunOf(lo);
        if (run) info.rows.push(['Side', `${fmt(run.length)} along its long side, ${fmt(run.depth)} deep on average`]);
        if (ghosts && ghosts.forId === sel.id && ghosts.forKind === 'support') {
          info.rows.push(['Suggestion', ghosts.list.length ? ghosts.list.map((g) => `${typeName(g.type)} ${Math.round(g.area).toLocaleString('en-US')} sf`).join(', ') : (ghosts.note || 'No unit fits this leftover.')]);
          if (ghosts.list.length) cardRefs.actions.append(btn('Accept all', 'accept-all', () => acceptGhosts(), { solid: true }));
          cardRefs.actions.append(btn('Dismiss', 'dismiss', () => dismissGhosts()));
        } else {
          info.rows.push(['Next', 'Fill with units, or make it an open stretch and draw units in it. Paint, Rectangle and Polygon also draw in a leftover.']);
          cardRefs.actions.append(
            btn('Fill with units', 'fill-leftover', () => fillLeftover(), { solid: true, disabled: !run, title: 'Show a layout of units for this leftover' }),
            btn('Make open stretch', 'open-leftover', () => openLeftover(), { disabled: !run, title: 'Make this leftover an open stretch to draw units in' }));
        }
      }
      if ((sel.kind === 'support' && isUserSupport(sel.id)) || (sel.kind === 'stair' && Store.raw().stairs.mode === 'manual')) {
        cardRefs.actions.append(btn('Delete', 'delete', () => deleteBlock(sel), { danger: true }));
      }
    }
    cardRefs.title.textContent = info.title;
    cardRefs.sub.textContent = info.sub || '';
    cardRefs.kv.textContent = '';
    for (const [k, v] of info.rows) cardRefs.kv.append(h('dt', null, k), h('dd', null, v));
  }

  /* ---- keyboard (Mac shortcuts) -------------------------------------------------------------------------------------------- */
  const VIEW_KEYS = { 1: 'axon', 2: 'n', 3: 'e', 4: 's', 5: 'w', 6: 'plan' };
  const TOOL_KEYS = { p: 'paint', s: 'suggest', r: 'rect', g: 'poly', v: 'select' };
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
      if (paint) { cancelPaint(); e.preventDefault(); }
      else if (draw && (draw.pts.length || !draw.persist)) { cancelDraw(); e.preventDefault(); }
      else if (ghosts) { dismissGhosts(); e.preventDefault(); }
      else if (sel) { clear(); e.preventDefault(); }
      else if (draw) { cancelDraw(); e.preventDefault(); }
      return;
    }
    if (key === 'Enter' && draw) { e.preventDefault(); finishDraw(); return; }
    if ((key === 'Delete' || key === 'Backspace') && sel && !draw) {
      if (sel.kind === 'unit') { e.preventDefault(); deleteUnit(); } else if (sel.kind !== 'free' && sel.kind !== 'corner') { e.preventDefault(); deleteBlock(sel); }
      return;
    }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'diagram' ? 'model' : 'diagram', { live: false }); return; }
    const tk = TOOL_KEYS[key.toLowerCase()];
    if (tk) { e.preventDefault(); setTool(tk); }
  }

  function init() {
    ready = Render.ready();
    drawBar();
    if (!$('selection-card')) return;
    Store.subscribe(() => {
      if (ghosts && !internal) { ghosts = null; renderGhosts(); }
      sanitize();
      syncCardText();
      refreshOverlay();
      syncHint();
    });
    if (!ready) return;
    buildTools();
    initOverlay();
    initPointer();
    window.addEventListener('keydown', onKey, true);
    Render.onRebuild(() => { sanitize(); refreshOverlay(); syncCardText(); syncHint(); });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener('change', refreshOverlay) : mq.addListener(refreshOverlay));
    window.addEventListener('resize', () => Render.requestRender());
    const c = Render.canvas();
    if (c) c.dataset.tool = tool;
    syncHint();
  }

  return {
    init,
    select: (it) => setSel(it), clear,
    get: () => (sel ? { ...sel } : null), count: () => (sel ? 1 : 0),
    pickAt, click, planAt, snapPoint, screenOf,
    // tools
    setTool, tool: () => tool, onTool: (fn) => toolListeners.push(fn), tools: () => TOOL_LIST.map((t) => t.id), selectCore,
    // drawing
    startDraw, cancelDraw, finishDraw, drawing: () => (draw ? { kind: draw.kind, points: draw.pts.length, persist: draw.persist } : null),
    drawTap: (cx, cy, alt) => (draw ? addDrawPoint(cx, cy, !!alt) : false),
    drawPoint: (x, y) => { if (!draw) return false; draw.pts.push([x, y]); syncDrawBar(); renderPreview(); return true; },
    addBlock, deleteBlock, setBlockRect, rectOf, setCoreMode, resetCore, setElevators, resizeCore, coreRectFor,
    // paint, free units, suggestions, clear
    paintOnRun, paintCorner, commitFree, suggest, acceptGhosts, dismissGhosts, ghosts: () => (ghosts ? { forKind: ghosts.forKind, forId: ghosts.forId, note: ghosts.note, list: ghosts.list.map((g) => ({ gid: g.gid, type: g.type, area: g.area, match: g.match, outer: g.outer })) } : null),
    clearLevel, clearLevelNow, openAt, openLeftover, fillLeftover,
    layoutInfo: () => { const lay = layout(); return lay ? { runs: lay.runs.map((r) => ({ id: r.id, length: r.length, depth: r.depth, start: r.start, end: r.end, u: r.u, n: r.n, startCorner: r.startCorner || null, endCorner: r.endCorner || null })), free: lay.free.map((f) => ({ ...f })), cornerZones: lay.cornerZones.map((z) => ({ id: z.id, outer: z.outer })), openArea: lay.openArea, units: lay.units.length, leftoverRuns: (lay.leftoverRuns || []).map((r) => ({ id: r.id, length: r.length, depth: r.depth, start: r.start, end: r.end, u: r.u, n: r.n })) } : null; },
    runPoint: (runId, s, t = 0) => { const r = runById(runId); return r ? runPoint(r, s, t) : null; },
    // units
    selectUnit: (k) => { const u = unitAt(k); return setSel({ kind: 'unit', id: String(k), k, uid: u ? u.uid : null }); },
    setUnitType, deleteUnit, splitUnit, mergeUnit, neighbors: (k) => neighborsOf(k), unitSize: (k) => { const u = unitAt(k); return u ? sizeOf(u) : null; },
    // bay lines
    bays: () => dragBays().map((e) => ({ a: e.a, b: e.b, mid: e.mid.slice(), t: e.t.slice(), run: e.run, s: e.s })),
    moveBay: (i, delta, live = false) => { const e = dragBays()[i]; if (!e) return false; const r = moveBayTo(e, e.s + delta, live, false); if (r && !live) { const u = sel && sel.kind === 'unit' ? sel.uid : null; if (u) reselect(u); } return !!r; },
    bayScreen: (i) => { const e = dragBays()[i]; return e ? screenOf(e.mid[0], e.mid[1], topZ() + 0.12) : null; },
    coreHandleScreen: (i) => { const c = coreHandles()[i]; return c ? screenOf(c[0], c[1], topZ() + 0.12) : null; },
    // for the shared placement gizmo
    dragging: () => !!drag || !!paint, handlesShown: () => handles.length > 0 || cornerHandles.length > 0,
    onChange: (fn) => listeners.push(fn), refreshOverlay,
    overlayInfo: () => ({ outline: group ? group.children.length : 0, preview: previewGroup ? previewGroup.children.length : 0, ghosts: ghostGroup ? ghostGroup.children.length : 0, handles: handles.length, cornerHandles: cornerHandles.length }),
    liveText: () => (live && !live.hidden ? live.textContent : ''),
  };
})();
