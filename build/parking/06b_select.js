import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ==========================================================================
   SELECT  (plan section 5.3: handles and snapping)
   Select by clicking, the selection card, handles, snapping during a drag, delete and the Mac shortcuts.

   Selection state lives HERE, never in the Store, so it is never saved, exported or undone. Every edit goes through the
   Store: a handle drag is a run of live sets that commit as ONE undo step.

   Items:  { kind: 'footprint' } · { kind: 'core', id } · { kind: 'entry', id } · { kind: 'speed' }
     footprint  standalone rectangle only (in the massing frame): move x, move y, rotate (5-degree snap), width, depth
     core       move x, move y (layout frame). Cores that come from the project are not draggable (Make the cores editable).
     entry      slide along its side
     speed      move x, move y (kept inside the strip), length

   Handles are DOM elements in a layer over the canvas. They follow the camera every drawn frame (Render.onFrame), so they keep
   a constant size on screen. The outline and the snap guides are 3D lines in the Render overlay group (never captured).
   Cores, entries and the speed ramp live in the LAYOUT frame; their outlines, pick proxies and guides take Derived.matrix.
   The footprint rectangle lives in the massing (local) frame, so its guides take no matrix.
   ========================================================================== */
const Select = (() => {
  const $ = (id) => document.getElementById(id);
  const MAXD = CONFIG.limits.maxDim;
  const PICK_PX = 6, PICK_MS = 400;          // a press shorter than this and moving less than this is a click, otherwise an orbit
  const HIDE_DOT = 0.95;                     // a handle whose axis points along the view direction is hidden
  const GUIDE_COLOR = '#f28a1a';
  const TOL_PX = 12, TOL_PX_TOUCH = 16;
  const AX = new THREE.Vector3(1, 0, 0);     // plan +x in world space
  const AY = new THREE.Vector3(0, 0, -1);    // plan +y (north) in world space
  const AZ = new THREE.Vector3(0, 1, 0);     // up
  const KINDS = ['footprint', 'core', 'entry', 'speed'];
  const fmt = (v) => Units.formatFeetInches(v);
  const isCoarse = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const sheetMode = () => !!(window.matchMedia && matchMedia('(max-width: 899px), (orientation: portrait)').matches);
  const worldDir = (dx, dy) => new THREE.Vector3(...planToWorld(dx, dy, 0)).normalize();
  const D = () => Derived.get();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let items = [];                            // the selection, in the order it was made
  let ready = false;                         // Render has a canvas
  let fieldsOpen = !sheetMode();             // the card's Dimensions block (collapsed by default on the bottom sheet)
  let drag = null;                           // the handle drag in progress
  let lastDrag = null;                       // label + guides of the last drag step (tests)
  const listeners = [];

  /* ---- frames ----------------------------------------------------------------- */
  /** A layout-frame point as a world vector (through the frame matrix). */
  const LW = (x, y, z = 0) => worldVec(x, y, z).applyMatrix4(D().matrix);
  /** A layout-frame direction as a unit world vector. */
  const LDIR = (dx, dy) => worldVec(dx, dy, 0).sub(worldVec(0, 0, 0)).transformDirection(D().matrix);

  /* ---- items ------------------------------------------------------------------ */
  const idOf = (it) => (it.id !== undefined ? it.id : '');
  const normItem = (it) => (it.kind === 'core' || it.kind === 'entry' ? { kind: it.kind, id: it.id } : { kind: it.kind });
  const sameItem = (a, b) => a.kind === b.kind && idOf(a) === idOf(b);
  const coreIndex = (s, id) => (s.cores || []).findIndex((c) => c.id === id);
  const entryIndex = (s, id) => (s.entries || []).findIndex((e) => e.id === id);
  const coreOf = (id) => D().cores.find((c) => c.id === id) || null;

  function isValid(it) {
    if (!it || !KINDS.includes(it.kind)) return false;
    const s = Store.raw();
    switch (it.kind) {
      case 'footprint': return s.source === 'standalone';
      case 'core': return !!coreOf(it.id) || coreIndex(s, it.id) >= 0;
      case 'entry': return entryIndex(s, it.id) >= 0;
      case 'speed': return s.ramp.type === 'speed';
      default: return false;
    }
  }
  /** True when the item's record can be written to (a core from the project cannot). */
  function editable(it) {
    if (it.kind === 'core') { const c = coreOf(it.id); return !(c && c.fromProject) && coreIndex(Store.raw(), it.id) >= 0; }
    return isValid(it);
  }
  /** The Store path of the item's record ('footprint', 'cores.0', 'entries.1', 'ramp.speed'), or null. */
  function basePath(it) {
    const s = Store.raw();
    switch (it.kind) {
      case 'footprint': return 'footprint';
      case 'core': { const i = coreIndex(s, it.id); return i < 0 ? null : `cores.${i}`; }
      case 'entry': { const i = entryIndex(s, it.id); return i < 0 ? null : `entries.${i}`; }
      case 'speed': return 'ramp.speed';
      default: return null;
    }
  }
  function itemName(it) {
    switch (it.kind) {
      case 'footprint': return 'Footprint';
      case 'core': { const c = coreOf(it.id); return `${c && c.kind === 'elevator' ? 'Elevator' : 'Stair'} ${it.id}`; }
      case 'entry': return `Entry ${it.id}`;
      default: return 'Speed ramp';
    }
  }
  function itemSub(it) {
    const s = Store.raw();
    try {
      switch (it.kind) {
        case 'footprint': return `${fmt(s.footprint.width)} × ${fmt(s.footprint.depth)} · ${num(s.footprint.angle, 0)}°`;
        case 'core': { const c = coreOf(it.id); const iss = D().coreIssues[it.id]; return `${fmt(c.w)} × ${fmt(c.d)}${c.fromProject ? ' · from the project' : ''}${iss === 'aisle' ? ' · in a drive aisle' : iss === 'outside' ? ' · outside the deck' : ''}`; }
        case 'entry': { const e = s.entries[entryIndex(s, it.id)]; return `${e.side} side · ${fmt(e.width)} lane at ${fmt(e.at)}`; }
        default: return `${s.ramp.speed.shape === 'circular' ? 'Circular' : 'Straight'} · ${fmt(s.ramp.speed.width)} wide`;
      }
    } catch (e) { return it.kind; }
  }

  /** Elevation range { z0, z1 } of the deck (every item spans it, except an entry, which is the entry level). */
  function zRange(it) {
    const d = D(), lv = d.levels;
    if (!lv.length) return null;
    if (it && it.kind === 'entry') {
      const e = lv.find((l) => l.index === d.raw.entryLevel) || lv[0];
      return { z0: e.z, z1: e.z + e.ftf };
    }
    const last = lv[lv.length - 1];
    return { z0: lv[0].z, z1: last.z + last.ftf };
  }

  /* ==========================================================================
     Boxes
     ========================================================================== */
  const box4 = (b) => ({ minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] });
  /** The footprint rectangle as ring corners in the massing frame. */
  function footprintRing(f) {
    const w = num(f.width, 0), dd = num(f.depth, 0), a = (num(f.angle, 0) * Math.PI) / 180;
    const u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)], c = [num(f.x, 0), num(f.y, 0)];
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + u[0] * w / 2 * i + v[0] * dd / 2 * j, c[1] + u[1] * w / 2 * i + v[1] * dd / 2 * j]);
  }
  /** Plan box of an item: { box, frame: 'local' | 'layout' }. */
  function footprintOf(it) {
    const s = Store.raw(), d = D();
    if (it.kind === 'footprint') return { box: boxOfRings([footprintRing(s.footprint)]), frame: 'local' };
    if (it.kind === 'core') { const c = coreOf(it.id); return c ? { box: c.box, frame: 'layout' } : null; }
    if (it.kind === 'entry') {
      const lv = d.raw.levels.find((l) => l.index === d.raw.entryLevel) || d.raw.levels[0];
      const cut = lv && (lv.cuts || []).find((c) => c.kind === 'entry' && c.id === it.id);
      return cut && cut.ring ? { box: boxOfRings([cut.ring]), frame: 'layout' } : null;
    }
    const fp = RampsMod.speedRampFootprint(s);
    return fp ? { box: box4(fp.box), frame: 'layout' } : null;
  }

  /* ==========================================================================
     Picking: invisible proxy meshes (one per item, in the layout frame under Derived.matrix), raycast on a click
     ========================================================================== */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let pickCache = null;

  function extrude(polys, z, depth) {
    const shapes = polys.map((poly) => {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q[0], q[1])));
      for (const hole of poly.holes || []) shape.holes.push(new THREE.Path(hole.map((q) => new THREE.Vector2(q[0], q[1]))));
      return shape;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(0.05, depth), bevelEnabled: false, steps: 1, curveSegments: 1 });
    geo.deleteAttribute('uv');
    geo.applyMatrix4(planMatrix(z));
    return geo;
  }
  function mergeInto(meshes, geos, item, rank, matrix) {
    const list = geos.filter((g) => g && g.getAttribute('position') && g.getAttribute('position').count);
    if (!list.length) return;
    const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
    if (list.length > 1) list.forEach((g) => g.dispose());
    if (!merged) return;
    const m = new THREE.Mesh(merged, pickMat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(matrix); m.matrixWorld.copy(matrix);
    m.userData.item = item; m.userData.rank = rank;
    meshes.push(m);
  }
  function disposePick() {
    if (!pickCache) return;
    pickCache.meshes.forEach((m) => m.geometry.dispose());
    pickCache = null;
  }
  function pickSet() {
    const d = D(), s = Store.raw();
    const key = [d.id, s.source].join('|');
    if (pickCache && pickCache.key === key) return pickCache;
    disposePick();
    const meshes = [];
    const r = zRange(null);
    if (r) {
      for (const c of d.cores) {
        try { mergeInto(meshes, [extrude([{ outer: rectRing(c.x, c.y, c.w, c.d), holes: [] }], r.z0, r.z1 - r.z0)], { kind: 'core', id: c.id }, 0, d.matrix); } catch (e) { /* skip */ }
      }
      const el = zRange({ kind: 'entry' });
      const lv = d.raw.levels.find((l) => l.index === d.raw.entryLevel) || d.raw.levels[0];
      for (const cut of (lv && lv.cuts) || []) {
        if (cut.kind !== 'entry' || !cut.ring) continue;
        try { mergeInto(meshes, [extrude([{ outer: cut.ring, holes: [] }], el.z0, Math.max(1, el.z1 - el.z0))], { kind: 'entry', id: cut.id }, 0, d.matrix); } catch (e) { /* skip */ }
      }
      const sp = s.ramp.type === 'speed' ? RampsMod.speedRampFootprint(s) : null;
      if (sp && sp.ring) { try { mergeInto(meshes, [extrude([{ outer: sp.ring, holes: [] }], r.z0, r.z1 - r.z0)], { kind: 'speed' }, 0, d.matrix); } catch (e) { /* skip */ } }
      if (s.source === 'standalone') {
        const geos = [];
        for (const l of d.levels) if (l.plate.length) { try { geos.push(extrude(l.plate, l.z, l.ftf)); } catch (e) { /* skip */ } }
        mergeInto(meshes, geos, { kind: 'footprint' }, 1, d.matrix);
      }
    }
    pickCache = { key, meshes };
    return pickCache;
  }

  function canvasRect() { const c = Render.canvas(); return c ? c.getBoundingClientRect() : null; }
  function camera() { const c = Render.camera(); c.updateMatrixWorld(true); return c; }
  function setRay(cx, cy) {
    const rect = canvasRect(), cam = camera();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    return raycaster.ray;
  }
  /** The item under a screen point (client px), or null. Cores, entries and the ramp win over the deck body. */
  function pickAt(cx, cy) {
    if (!ready || Render.comparing()) return null;
    setRay(cx, cy);
    const hits = raycaster.intersectObjects(pickSet().meshes, false);
    let body = null;
    for (const hit of hits) {
      if (hit.object.userData.rank === 1) { if (!body) body = hit.object.userData.item; continue; }
      return { ...hit.object.userData.item };
    }
    return body ? { ...body } : null;
  }
  const toClient = (v3) => {
    const rect = canvasRect(), p = v3.clone().project(camera());
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, z: p.z };
  };
  /** A client point where the item can be picked. Used by tests. */
  function screenPointFor(it) {
    if (!ready) return null;
    const fp = footprintOf(it), r = zRange(it);
    if (!fp || !r) return null;
    const box = fp.box, M = D().matrix;
    const fr = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (const fz of fr) for (const fx of fr) for (const fy of fr) {
      let v = worldVec(box.minX + (box.maxX - box.minX) * fx, box.minY + (box.maxY - box.minY) * fy, r.z0 + (r.z1 - r.z0) * fz);
      if (fp.frame === 'layout') v = v.applyMatrix4(M);
      const p = toClient(v);
      if (p.z < -1 || p.z > 1) continue;
      const hit = pickAt(p.x, p.y);
      if (hit && sameItem(hit, normItem(it))) return { x: p.x, y: p.y };
    }
    return null;
  }

  /* ==========================================================================
     Overlay: selection outline and snap guides (3D lines)
     ========================================================================== */
  let outlineGroup = null, guideGroup = null;
  let mOutline = null, mHalo = null, mGhost = null, mGuide = null, mSheet = null;
  const cssColorOf = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

  function initOverlay() {
    const root = Render.overlayGroup();
    outlineGroup = new THREE.Group(); guideGroup = new THREE.Group();
    outlineGroup.matrixAutoUpdate = false; guideGroup.matrixAutoUpdate = false;
    root.add(outlineGroup, guideGroup);
    const fatMat = (o) => new LineMaterial({ color: 0x23508f, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...o });
    mGhost = fatMat({ linewidth: 1.25, opacity: 0.3, depthTest: false });
    mHalo = fatMat({ linewidth: 4.25, opacity: 0.9, depthTest: true });
    mOutline = fatMat({ linewidth: 2, opacity: 1, depthTest: true });
    mGuide = new THREE.LineDashedMaterial({ color: GUIDE_COLOR, dashSize: 6, gapSize: 4, depthTest: false, transparent: true });
    mSheet = new THREE.MeshBasicMaterial({ color: GUIDE_COLOR, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  }
  function setGroupMatrix(g, m) { g.matrix.copy(m); g.matrixWorldNeedsUpdate = true; }
  function clearGroup(g) {
    for (const o of [...g.children]) { g.remove(o); if (o.geometry) o.geometry.dispose(); }
  }
  function lines(group, pos, material, order, dashed) {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(geo, material);
    ls.renderOrder = order;
    ls.frustumCulled = false;
    if (dashed) ls.computeLineDistances();
    group.add(ls);
  }
  function fat(group, pos, material, order) {
    if (!pos.length) return;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const ls = new LineSegments2(geo, material);
    ls.renderOrder = order;
    ls.frustumCulled = false;
    group.add(ls);
  }
  function pushEdges(pos, geo) {
    const e = new THREE.EdgesGeometry(geo, 20);
    const a = e.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
    e.dispose(); geo.dispose();
  }
  /** Outline edges of an item in its own frame (layout frame, except the footprint which is drawn from the deck plates). */
  function pushOutline(pos, it) {
    const s = Store.raw(), d = D();
    const r = zRange(it);
    if (!r) return;
    if (it.kind === 'footprint') {
      for (const l of d.levels) if (l.plate.length) pushEdges(pos, extrude(l.plate, l.z, l.ftf));
    } else if (it.kind === 'core') {
      const c = coreOf(it.id);
      if (c) pushEdges(pos, extrude([{ outer: rectRing(c.x, c.y, c.w, c.d), holes: [] }], r.z0, r.z1 - r.z0));
    } else if (it.kind === 'entry') {
      const fp = footprintOf(it);
      if (fp) pushEdges(pos, extrude([{ outer: rectRing(fp.box.minX, fp.box.minY, fp.box.maxX - fp.box.minX, fp.box.maxY - fp.box.minY), holes: [] }], r.z0, Math.max(1, r.z1 - r.z0)));
    } else {
      const sp = RampsMod.speedRampFootprint(s);
      if (sp) pushEdges(pos, extrude([{ outer: sp.ring, holes: [] }], r.z0, r.z1 - r.z0));
    }
  }
  function refreshOverlay() {
    if (!ready || !outlineGroup) return;
    clearGroup(outlineGroup);
    setGroupMatrix(outlineGroup, D().matrix);
    if (Render.comparing()) { Render.requestRender(); return; }
    const accent = cssColorOf('--accent', '#23508f');
    mOutline.color.copy(accent); mGhost.color.copy(accent);
    mHalo.color.copy(cssColorOf('--surface', '#ffffff'));
    const pos = [];
    for (const it of items) { try { pushOutline(pos, it); } catch (e) { console.error(e); } }
    fat(outlineGroup, pos, mGhost, 11);
    fat(outlineGroup, pos, mHalo, 12);
    fat(outlineGroup, pos, mOutline, 13);
    Render.requestRender();
  }
  function showGuides(guides, zTop, frame) {
    clearGroup(guideGroup);
    setGroupMatrix(guideGroup, frame === 'layout' ? D().matrix : new THREE.Matrix4());
    const pos = [], quads = [];
    for (const g of guides || []) {
      if (!g || g.kind === 'grid') continue;
      const a = g.axis === 'x' ? [g.value, g.from] : [g.from, g.value];
      const b = g.axis === 'x' ? [g.value, g.to] : [g.to, g.value];
      const z = Math.max(6, zTop);
      const P = (q, e) => planToWorld(q[0], q[1], e);
      const seg = (p, q) => pos.push(...p, ...q);
      seg(P(a, 0.4), P(b, 0.4)); seg(P(a, z), P(b, z));
      seg(P(a, 0.4), P(a, z)); seg(P(b, 0.4), P(b, z));
      quads.push(...P(a, 0.4), ...P(b, 0.4), ...P(b, z), ...P(a, 0.4), ...P(b, z), ...P(a, z));
    }
    if (quads.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(quads, 3));
      const sheet = new THREE.Mesh(geo, mSheet);
      sheet.renderOrder = 13; sheet.frustumCulled = false;
      guideGroup.add(sheet);
    }
    lines(guideGroup, pos, mGuide, 14, true);
    Render.requestRender();
  }

  /* ==========================================================================
     Snap targets
     ========================================================================== */
  function boxLinesOf(out, b, kind, label) {
    out.push({ axis: 'x', value: b.minX, kind, label: `${label} west edge`, from: b.minY, to: b.maxY });
    out.push({ axis: 'x', value: b.maxX, kind, label: `${label} east edge`, from: b.minY, to: b.maxY });
    out.push({ axis: 'y', value: b.minY, kind, label: `${label} south edge`, from: b.minX, to: b.maxX });
    out.push({ axis: 'y', value: b.maxY, kind, label: `${label} north edge`, from: b.minX, to: b.maxX });
  }
  /** Layout-frame lines: the footprint edges, the run, the bay and row lines, the column lines, the strip and the other cores. */
  function layoutTargets(exclude) {
    const d = D(), raw = d.raw, out = [];
    const W = raw.frame.W, Dp = raw.frame.D;
    boxLinesOf(out, { minX: 0, maxX: W, minY: 0, maxY: Dp }, 'site', 'Deck');
    if (raw.run) {
      out.push({ axis: 'x', value: raw.run.xs, kind: 'setback', label: 'Start of the stall run', from: 0, to: Dp });
      out.push({ axis: 'x', value: raw.run.xe, kind: 'setback', label: 'End of the stall run', from: 0, to: Dp });
    }
    for (const bay of raw.bays) {
      const xs = raw.run ? raw.run.xs : 0, xe = raw.run ? raw.run.xe : W;
      for (const row of bay.rows) {
        out.push({ axis: 'y', value: row.y0, kind: 'podium', label: `Row ${row.id} south edge`, from: xs, to: xe });
        out.push({ axis: 'y', value: row.y1, kind: 'podium', label: `Row ${row.id} north edge`, from: xs, to: xe });
      }
      if (bay.aisle) {
        out.push({ axis: 'y', value: bay.aisle.y0, kind: 'podium', label: 'Aisle south edge', from: xs, to: xe });
        out.push({ axis: 'y', value: bay.aisle.y1, kind: 'podium', label: 'Aisle north edge', from: xs, to: xe });
      }
    }
    if (raw.strip) {
      out.push({ axis: 'y', value: raw.strip.y0, kind: 'context', label: 'Strip south edge', from: 0, to: W });
      out.push({ axis: 'y', value: raw.strip.y1, kind: 'context', label: 'Strip north edge', from: 0, to: W });
    }
    const cols = d.columns && d.columns.lines;
    if (Array.isArray(cols) && cols.length) {
      const xs = new Set();
      for (const l of cols) for (const x of l.xs || []) xs.add(Math.round(x * 100) / 100);
      const ys = cols.map((l) => l.y), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const x of xs) out.push({ axis: 'x', value: x, kind: 'setback', label: 'Column line', from: y0, to: y1 });
    }
    for (const c of d.cores) if (!(exclude && exclude.kind === 'core' && exclude.id === c.id)) boxLinesOf(out, c.box, 'segment', `Core ${c.id}`);
    return out;
  }
  /** Massing-frame lines for the footprint: the plates of the project levels (the context). */
  function localTargets() {
    const out = [];
    try {
      for (const g of ProjectUI.ghostLevels(Store.raw())) {
        const b = boxOfPolys(g.polys);
        if (b) boxLinesOf(out, b, 'context', 'Massing');
      }
    } catch (e) { /* no project */ }
    return out;
  }

  /* ==========================================================================
     Handles
     ========================================================================== */
  let layer = null, labelEl = null;
  const hEls = {};
  const HANDLE_DEFS = [
    ['move-x', 'move', 'Move east or west'],
    ['move-y', 'move', 'Move north or south'],
    ['slide', 'move', 'Slide along the side'],
    ['rotate', 'rotate', 'Rotate the footprint'],
    ['width', 'resize', 'Change the width'],
    ['depth', 'resize', 'Change the depth'],
    ['length', 'resize', 'Change the ramp length'],
  ];
  const GLYPH = {
    move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>',
    resize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M7 12h13M16 8l4 4-4 4"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 11-3-6.2"/><path d="M20 4v5h-5"/></svg>',
  };

  function buildHandleLayer() {
    const host = $('canvasHost');
    layer = h('div', { class: 'hdl-layer', id: 'handleLayer', hidden: true });
    host.parentNode.insertBefore(layer, host.nextSibling);
    labelEl = h('div', { class: 'hdl-label', id: 'dragLabel', hidden: true, role: 'status' });
    layer.append(labelEl);
    for (const [id, kind, text] of HANDLE_DEFS) {
      const el = h('div', { class: `hdl hdl-${kind}`, 'data-handle': id, role: 'button', 'aria-label': text, title: text, hidden: true },
        h('span', { class: 'hdl-glyph', html: GLYPH[kind] }));
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        if (startDrag(id, e.clientX, e.clientY, { pointerId: e.pointerId, touch: e.pointerType !== 'mouse', alt: e.altKey })) {
          try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ }
        }
      });
      el.addEventListener('pointermove', (e) => { if (drag && drag.pointerId === e.pointerId) queueMove(e.clientX, e.clientY, e.altKey); });
      el.addEventListener('pointerup', (e) => { if (drag && drag.pointerId === e.pointerId) { flushMove(); endDrag(true); } });
      el.addEventListener('pointercancel', (e) => { if (drag && drag.pointerId === e.pointerId) endDrag(false); });
      layer.append(el);
      hEls[id] = el;
    }
  }

  /** The handle definitions for a single selected item: anchor (world), the axis it moves along, which way is "outward". */
  function handleInfo(it) {
    if (!isValid(it) || !editable(it)) return null;
    const s = Store.raw();
    const fp = footprintOf(it), r = zRange(it);
    if (!fp || !r) return null;
    const { z0, z1 } = r;
    const b = fp.box, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const hs = [];
    if (it.kind === 'footprint') {
      const f = s.footprint;
      if (f.shape === 'polygon') return null;
      const a = (num(f.angle, 0) * Math.PI) / 180, w = num(f.width, 0), dd = num(f.depth, 0);
      const u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)], c = [num(f.x, 0), num(f.y, 0)];
      hs.push({ id: 'move-x', kind: 'move', anchor: worldVec(cx, b.minY, z0), axis: AX, out: AY.clone().negate() });
      hs.push({ id: 'move-y', kind: 'move', anchor: worldVec(b.minX, cy, z0), axis: AY, out: AX.clone().negate() });
      const corner = [c[0] + u[0] * w / 2 + v[0] * dd / 2, c[1] + u[1] * w / 2 + v[1] * dd / 2];
      hs.push({ id: 'rotate', kind: 'rotate', anchor: worldVec(corner[0], corner[1], z0), axis: AX, out: worldDir(corner[0] - c[0], corner[1] - c[1]), flat: true, far: 30 });
      hs.push({ id: 'width', kind: 'resize', anchor: worldVec(c[0] + u[0] * w / 2, c[1] + u[1] * w / 2, z1), axis: worldDir(u[0], u[1]), out: worldDir(u[0], u[1]) });
      hs.push({ id: 'depth', kind: 'resize', anchor: worldVec(c[0] + v[0] * dd / 2, c[1] + v[1] * dd / 2, z1), axis: worldDir(v[0], v[1]), out: worldDir(v[0], v[1]) });
    } else if (it.kind === 'core') {
      hs.push({ id: 'move-x', kind: 'move', anchor: LW(cx, b.minY, z1), axis: LDIR(1, 0), out: LDIR(0, -1) });
      hs.push({ id: 'move-y', kind: 'move', anchor: LW(b.minX, cy, z1), axis: LDIR(0, 1), out: LDIR(-1, 0) });
    } else if (it.kind === 'entry') {
      const e = s.entries[entryIndex(s, it.id)];
      const alongY = e.side === 'west' || e.side === 'east';
      hs.push({ id: 'slide', kind: 'move', anchor: LW(cx, cy, z1), axis: alongY ? LDIR(0, 1) : LDIR(1, 0), out: alongY ? LDIR(e.side === 'west' ? -1 : 1, 0) : LDIR(0, e.side === 'south' ? -1 : 1) });
    } else {
      hs.push({ id: 'move-x', kind: 'move', anchor: LW(cx, b.minY, z1), axis: LDIR(1, 0), out: LDIR(0, -1) });
      hs.push({ id: 'move-y', kind: 'move', anchor: LW(b.minX, cy, z1), axis: LDIR(0, 1), out: LDIR(-1, 0) });
      if (s.ramp.speed.shape !== 'circular') hs.push({ id: 'length', kind: 'resize', anchor: LW(b.maxX, cy, z1), axis: LDIR(1, 0), out: LDIR(1, 0) });
    }
    return { item: it, fp, z0, z1, hs, frame: fp.frame };
  }
  function handlesWanted() {
    return ready && items.length === 1 && !Render.comparing();
  }

  const _v = new THREE.Vector3(), _f = new THREE.Vector3();
  /** Which view direction applies at a point: the camera's own for an orthographic camera, the line of sight for a perspective one. */
  function viewDirAt(P) {
    const cam = camera();
    if (Render.cameraType() === 'ortho') return cam.getWorldDirection(new THREE.Vector3());
    return P.clone().sub(cam.position).normalize();
  }
  function syncHandles() {
    if (!layer) return;
    const rc = canvasRect();
    if (rc && mOutline) for (const m of [mOutline, mHalo, mGhost]) m.resolution.set(rc.width, rc.height);
    if (!handlesWanted()) { layer.hidden = true; if (!drag) labelEl.hidden = true; return; }
    const info = handleInfo(items[0]);
    if (!info) { layer.hidden = true; return; }
    layer.hidden = false;
    const cam = camera(), rect = canvasRect();
    const fwd = cam.getWorldDirection(_f).clone();
    const elevation = Math.abs(fwd.y) < 0.35;
    const px = (v3) => { const p = _v.copy(v3).project(cam); return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, z: p.z }; };
    const coarse = isCoarse();
    const present = new Set();
    for (const hd of info.hs) {
      const el = hEls[hd.id];
      const f = viewDirAt(hd.anchor);
      let hide = Math.abs(hd.axis.dot(f)) > HIDE_DOT || (drag && drag.id !== hd.id);
      if (hd.flat && elevation) hide = true;                       // the rotate handle needs a view from above
      const p = px(hd.anchor);
      if (p.z < -1 || p.z > 1) hide = true;
      if (hide) { el.hidden = true; continue; }
      let ox = 0, oy = 0;
      if (hd.kind === 'move' && elevation) oy = coarse ? 32 : 26;
      else if (hd.out) {
        const q = px(hd.anchor.clone().addScaledVector(hd.out, 1));
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
        const off = (hd.kind === 'move' ? 26 : hd.far || 18) + (coarse ? 6 : 0);
        if (len > 0.02) { ox = (dx / len) * off; oy = (dy / len) * off; } else oy = off;
      }
      let ang = 0;
      if (hd.kind === 'move' || hd.kind === 'resize') {
        const q = px(hd.anchor.clone().addScaledVector(hd.axis, 10));
        ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      }
      el.hidden = false;
      el.style.transform = `translate(${(p.x + ox).toFixed(1)}px, ${(p.y + oy).toFixed(1)}px)`;
      el.firstChild.firstChild.style.transform = hd.kind === 'rotate' ? '' : `rotate(${ang.toFixed(1)}deg)`;
      el.classList.toggle('is-active', !!drag && drag.id === hd.id);
      present.add(hd.id);
    }
    for (const id of Object.keys(hEls)) if (!present.has(id)) hEls[id].hidden = true;
  }
  /** Ids of the handles that show right now (tests). */
  function visibleHandles() {
    syncHandles();
    return Object.keys(hEls).filter((id) => !hEls[id].hidden && !layer.hidden);
  }

  /* ---- drag ------------------------------------------------------------------- */
  function ftPerPx(P) {
    const cam = camera(), rect = canvasRect();
    if (Render.cameraType() === 'ortho') return (cam.top - cam.bottom) / cam.zoom / rect.height;
    const a = toClient(P), bx = toClient(P.clone().add(AX)), by = toClient(P.clone().add(AY));
    const pf = (Math.hypot(bx.x - a.x, bx.y - a.y) + Math.hypot(by.x - a.x, by.y - a.y)) / 2;
    return pf > 1e-6 ? 1 / pf : 1;
  }
  const snapSettings = () => { const sn = Store.get('view.snap') || {}; return { on: sn.on !== false, grid: sn.grid === 5 ? 5 : 1 }; };

  /** Where the pointer is along the handle's axis: its ray meets the plane that holds the axis and faces the camera. */
  function pointerParam(cx, cy) {
    const ray = setRay(cx, cy);
    const denom = drag.n.dot(ray.direction);
    if (Math.abs(denom) < 1e-5) return null;
    const tt = drag.n.dot(_v.copy(drag.p0).sub(ray.origin)) / denom;
    if (Render.cameraType() !== 'ortho' && tt < 0) return null;
    const hit = ray.origin.clone().addScaledVector(ray.direction, tt);
    return hit.sub(drag.p0).dot(drag.axis);
  }
  /** The massing-frame plan point under the pointer on the horizontal plane at `elev` (for the rotate handle), or null. */
  function pointerPlan(cx, cy, elev) {
    const ray = setRay(cx, cy);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const tt = (elev - ray.origin.y) / ray.direction.y;
    if (Render.cameraType() !== 'ortho' && tt < 0) return null;
    const hit = ray.origin.clone().addScaledVector(ray.direction, tt);
    return [hit.x, -hit.z];
  }
  function startDrag(id, cx, cy, opt = {}) {
    if (!ready) return false;
    if (drag) endDrag(true);
    if (!handlesWanted()) return false;
    const it = items[0];
    const info = handleInfo(it);
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return false;
    const touch = !!opt.touch;
    const f = viewDirAt(hd.anchor);
    const n = f.clone().addScaledVector(hd.axis, -f.dot(hd.axis));
    if (id !== 'rotate' && n.lengthSq() < 1e-8) return false;
    n.normalize();
    const box = info.fp.box;
    const frame = info.frame;
    const center = frame === 'layout' ? LW((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0) : worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0);
    drag = {
      id, item: it, info, fp: info.fp, frame, p0: hd.anchor.clone(), axis: hd.axis.clone(), n, t0: 0, elev: info.z0,
      pointerId: opt.pointerId, touch, orig: {}, pending: null, raf: 0,
      targets: frame === 'layout' ? layoutTargets(it.kind === 'core' ? it : null) : localTargets(),
      tol: clamp(ftPerPx(center) * (touch ? TOL_PX_TOUCH : TOL_PX), 0.5, 20),
      base: clone(Store.get(basePath(it))),
      strip: D().raw.strip, frameW: D().raw.frame.W, frameD: D().raw.frame.D,
    };
    if (id !== 'rotate') {
      const t0 = pointerParam(cx, cy);
      if (t0 == null) { drag = null; return false; }
      drag.t0 = t0;
    }
    Render.setOrbitEnabled(false);
    $('viewport').dataset.dragging = id;
    lastDrag = { id, label: '', guides: [] };
    syncHandles();
    return true;
  }
  function queueMove(cx, cy, alt) {
    if (!drag) return;
    drag.pending = { cx, cy, alt };
    if (!drag.raf) drag.raf = requestAnimationFrame(() => { drag && (drag.raf = 0); flushMove(); });
  }
  function flushMove() {
    if (!drag || !drag.pending) return;
    const { cx, cy, alt } = drag.pending;
    drag.pending = null;
    dragMove(cx, cy, !!alt);
  }
  function write(path, value) {
    if (!(path in drag.orig)) drag.orig[path] = clone(Store.get(path));
    Store.set(path, value, { live: true });
  }
  const r4 = (v) => rnd(v, 10000);

  function dragMove(cx, cy, alt) {
    if (!drag) return null;
    const sn = snapSettings();
    const enabled = sn.on && !alt;
    const it = drag.item, id = drag.id, base = drag.base;
    const bp = basePath(it);
    if (!bp) return lastDrag;
    let label = '', guides = [];
    const box = drag.fp.box;

    if (id === 'rotate') {
      const p = pointerPlan(cx, cy, drag.elev);
      if (!p) return lastDrag;
      const off = (Math.atan2(num(base.depth, 1), num(base.width, 1)) * 180) / Math.PI;     // the handle sits at the far corner
      let ang = (Math.atan2(p[1] - num(base.y, 0), p[0] - num(base.x, 0)) * 180) / Math.PI - off;
      ang = enabled ? Math.round(ang / 5) * 5 : Math.round(ang * 10) / 10;
      while (ang > 180) ang -= 360;
      while (ang <= -180) ang += 360;
      write(`${bp}.angle`, ang);
      label = `Angle ${ang}°`;
    } else {
      const t0 = pointerParam(cx, cy);
      if (t0 == null) return lastDrag;
      const t = t0 - drag.t0;
      const tolOpts = { tolerance: drag.tol, grid: sn.grid, enabled };
      if (it.kind === 'footprint') {
        if (id === 'move-x' || id === 'move-y') {
          const ax = id === 'move-x' ? 'x' : 'y';
          const res = SnapMod.snapMove(box, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, tolOpts);
          const delta = enabled ? (ax === 'x' ? res.dx : res.dy) : rnd(t, 10);
          guides = res.guides.filter((g) => g.axis === ax && g.kind !== 'grid');
          const v = r4(num(base[ax], 0) + delta);
          write(`${bp}.${ax}`, v);
          label = `Center ${ax} ${fmt(v)}`;
        } else {
          const isW = id === 'width';
          const a = (num(base.angle, 0) * Math.PI) / 180;
          const dir = isW ? [Math.cos(a), Math.sin(a)] : [-Math.sin(a), Math.cos(a)];
          const e0 = isW ? num(base.width, 0) : num(base.depth, 0);
          const ext = clamp(SnapMod.snapLength(e0 + t, { step: enabled ? 1 : 0.1 }), 20, MAXD);
          const shift = (ext - e0) / 2;                                  // the opposite edge stays
          write(`${bp}.${isW ? 'width' : 'depth'}`, r4(ext));
          write(`${bp}.x`, r4(num(base.x, 0) + dir[0] * shift));
          write(`${bp}.y`, r4(num(base.y, 0) + dir[1] * shift));
          label = `${isW ? 'Width' : 'Depth'} ${fmt(ext)}`;
        }
      } else if (it.kind === 'core') {
        const ax = id === 'move-x' ? 'x' : 'y';
        const res = SnapMod.snapMove(box, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, tolOpts);
        const delta = enabled ? (ax === 'x' ? res.dx : res.dy) : rnd(t, 10);
        guides = res.guides.filter((g) => g.axis === ax && g.kind !== 'grid');
        const v = r4(num(base[ax], 0) + delta);
        write(`${bp}.${ax}`, v);
        label = `Core ${ax} ${fmt(v)}`;
      } else if (it.kind === 'entry') {
        const alongY = base.side === 'west' || base.side === 'east';
        const ax = alongY ? 'y' : 'x';
        const res = SnapMod.snapMove(box, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, tolOpts);
        const delta = enabled ? (ax === 'x' ? res.dx : res.dy) : rnd(t, 10);
        guides = res.guides.filter((g) => g.axis === ax && g.kind !== 'grid');
        const wdt = num(base.width, 24), len = alongY ? drag.frameD : drag.frameW;
        const at = clamp(r4(num(base.at, 0) + delta), Math.min(wdt / 2, len / 2), Math.max(len - wdt / 2, len / 2));
        write(`${bp}.at`, at);
        label = `Entry at ${fmt(at)}`;
      } else {
        // the speed ramp
        const fpBox = box;
        const bw = fpBox.maxX - fpBox.minX, bd = fpBox.maxY - fpBox.minY;
        if (id === 'move-x' || id === 'move-y') {
          const ax = id === 'move-x' ? 'x' : 'y';
          const res = SnapMod.snapMove(fpBox, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, tolOpts);
          let delta = enabled ? (ax === 'x' ? res.dx : res.dy) : rnd(t, 10);
          guides = res.guides.filter((g) => g.axis === ax && g.kind !== 'grid');
          let v = num(base[ax], 0) + delta;
          if (ax === 'y' && drag.strip && drag.strip.y1 - drag.strip.y0 >= bd - 0.001) v = clamp(v, drag.strip.y0, drag.strip.y1 - bd);   // stays in the strip
          if (ax === 'x') v = clamp(v, 0, Math.max(0, drag.frameW - bw));
          write(`${bp}.${ax}`, r4(v));
          label = `Ramp ${ax} ${fmt(v)}`;
        } else {
          const T = RampsMod.speedRampFootprint({ ...Store.raw(), ramp: { ...Store.raw().ramp, speed: base } });
          const tr = T ? (T.box[2] - T.box[0]) - num(base.length, 0) : 0;      // the two transitions
          const r = SnapMod.snapEdge(fpBox.maxX + t, 'x', drag.targets, { tolerance: drag.tol, grid: 0, enabled, span: { from: fpBox.minY, to: fpBox.maxY } });
          let L = r.value - fpBox.minX - tr;
          if (!r.guide) L = SnapMod.snapLength(L, { step: enabled ? 1 : 0.1 });
          if (r.guide && r.guide.kind !== 'grid') guides = [r.guide];
          L = clamp(L, 20, Math.max(20, Math.min(400, drag.frameW - num(base.x, 0) - tr)));
          write(`${bp}.length`, r4(L));
          label = `Length ${fmt(L)}`;
        }
      }
    }
    lastDrag = { id, label, guides: guides.map((g) => ({ axis: g.axis, value: g.value, kind: g.kind, label: g.label })) };
    showGuides(guides, drag.info.z1, drag.frame);
    setLabel(label, guides, cx, cy);
    return lastDrag;
  }
  function setLabel(text, guides, cx, cy) {
    const rect = canvasRect();
    labelEl.hidden = false;
    labelEl.textContent = '';
    labelEl.append(h('b', null, text));
    const g = (guides || []).find((x) => x && x.label);
    if (g) labelEl.append(h('span', null, g.label));
    const x = clamp(cx - rect.left + 18, 8, rect.width - 190), y = clamp(cy - rect.top - 52, 8, rect.height - 60);
    labelEl.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  function endDrag(ok = true) {
    if (!drag) return;
    const d = drag;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag = null;
    if (!ok) for (const [path, v] of Object.entries(d.orig)) Store.set(path, v, { live: true });
    Store.commit();
    Render.setOrbitEnabled(true);
    delete $('viewport').dataset.dragging;
    clearGroup(guideGroup);
    labelEl.hidden = true;
    Render.requestRender();
    syncHandles();
  }

  /** Test hook: the same drag math as a real drag, driven by world deltas (feet) instead of pointer events.
   *  simulateHandleDrag('move-x', dx) · ('move-y', 0, dy) · ('slide', d) · ('width', dw) · ('depth', dd) · ('length', dl)
   *  · ('rotate', angleDegrees); opts { alt, hold }. With hold the drag stays open (guides and label stay on screen) until releaseHandleDrag(). */
  function simulateHandleDrag(id, a = 0, b = 0, opts = {}) {
    if (!ready) return null;
    if (drag) endDrag(true);
    const info = items.length === 1 ? handleInfo(items[0]) : null;
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return null;
    let target;
    if (id === 'rotate') {
      const f = Store.get('footprint');
      const off = Math.atan2(num(f.depth, 1), num(f.width, 1));
      const rad = (a * Math.PI) / 180 + off, R = 100;
      target = worldVec(num(f.x, 0) + R * Math.cos(rad), num(f.y, 0) + R * Math.sin(rad), info.z0);
    } else {
      const amount = (id === 'move-y') ? (b !== 0 ? b : a) : a;
      target = hd.anchor.clone().addScaledVector(hd.axis, amount);
    }
    const p0 = toClient(hd.anchor), p1 = toClient(target);
    if (!startDrag(id, p0.x, p0.y, { touch: !!opts.touch })) return null;
    const res = dragMove(p1.x, p1.y, !!opts.alt);
    if (!opts.hold) endDrag(true);
    return res;
  }

  /* ==========================================================================
     Selection actions
     ========================================================================== */
  function setItems(next) {
    const out = [];
    for (const it of next || []) {
      if (!it || !KINDS.includes(it.kind)) continue;
      const n = normItem(it);
      if (isValid(n) && !out.some((o) => sameItem(o, n))) out.push(n);
    }
    const changed = JSON.stringify(out) !== JSON.stringify(items);
    if (changed && drag) endDrag(false);
    items = out;
    if (changed) onChanged();
    return changed;
  }
  function toggleItem(it) {
    const n = normItem(it);
    return setItems(items.some((o) => sameItem(o, n)) ? items.filter((o) => !sameItem(o, n)) : [...items, n]);
  }
  const clear = () => setItems([]);
  function onChanged() {
    renderCard();
    refreshOverlay();
    syncHandles();
    syncRows();
    listeners.forEach((fn) => { try { fn(items.map((i) => ({ ...i }))); } catch (e) { console.error(e); } });
  }
  /** Drops items that no longer exist (undo, delete, the source changed). */
  function sanitize() {
    const kept = items.filter(isValid);
    if (kept.length !== items.length) { items = kept; if (drag) endDrag(false); onChanged(); return true; }
    return false;
  }

  function deleteItems(list) {
    const sel = (list || items).map(normItem).filter(isValid);
    if (!sel.length) return 0;
    const next = clone(Store.raw());
    let removed = 0;
    const coreIds = new Set(sel.filter((i) => i.kind === 'core' && editable(i)).map((i) => i.id));
    if (coreIds.size) { next.cores = next.cores.filter((c) => !coreIds.has(c.id)); removed += coreIds.size; }
    const entryIds = new Set(sel.filter((i) => i.kind === 'entry').map((i) => i.id));
    if (entryIds.size) { next.entries = next.entries.filter((e) => !entryIds.has(e.id)); removed += entryIds.size; }
    if (!removed) {
      if (sel.some((i) => i.kind === 'core')) Toast.show('These cores come from the project. Make the cores editable first.', 'warn', 4200);
      return 0;
    }
    Store.replace(next);
    setItems([]);
    return removed;
  }
  function deleteSelection() { return deleteItems(items); }

  /* ==========================================================================
     Click picking
     ========================================================================== */
  const downs = new Map();
  function initPointer() {
    const canvas = Render.canvas();
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      for (const r of downs.values()) r.cancel = true;                 // a second finger: a pinch or a pan, never a click
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
      click(e.clientX, e.clientY, e.shiftKey);
    });
    canvas.addEventListener('dblclick', (e) => {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) { setItems([hit]); UI.openItem(hit); }
    });
  }
  function click(cx, cy, shift) {
    const hit = pickAt(cx, cy);
    if (hit) { if (shift) toggleItem(hit); else setItems([hit]); }
    else if (!shift) clear();
    return hit;
  }

  /* ==========================================================================
     Selection card (#selection-card)
     ========================================================================== */
  let cardFns = [], cardRefs = null;
  /** A store bind for a field of the selected item, found by its id each time (so reordering the lists never breaks the card). */
  const bindItem = (it, sub) => ({
    get: () => { const p = basePath(it); return p ? Store.get(`${p}.${sub}`) : undefined; },
    set: (v, live) => { const p = basePath(it); if (p) Store.set(`${p}.${sub}`, v, { live }); },
    commit: () => Store.commit(),
  });
  const lenF = (it, label, sub, extra = {}) => Controls.slider({
    label, bind: bindItem(it, sub), min: 0, max: 1, step: 1, hardMin: 1, hardMax: MAXD, format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', compact: true, ...extra,
  });
  const offF = (it, label, sub) => lenF(it, label, sub, { hardMin: -MAXD });
  const degF = (it, label, sub) => Controls.slider({
    label, bind: bindItem(it, sub), min: 0, max: 1, step: 1, hardMin: -360, hardMax: 360, format: (v) => `${Math.round(v * 10) / 10}°`, inputMode: 'decimal', compact: true,
  });

  function fieldsFor(it) {
    const els = (list) => list.map((c) => c.el || c);
    if (!editable(it)) return [];
    if (it.kind === 'footprint') {
      if (Store.get('footprint.shape') === 'polygon') return [];
      return els([offF(it, 'Center x', 'x'), offF(it, 'Center y', 'y'), lenF(it, 'Width', 'width'), lenF(it, 'Depth', 'depth'), degF(it, 'Angle', 'angle')]);
    }
    if (it.kind === 'core') return els([offF(it, 'x', 'x'), offF(it, 'y', 'y'), lenF(it, 'Width', 'w'), lenF(it, 'Depth', 'd')]);
    if (it.kind === 'entry') return els([lenF(it, 'Along the side', 'at', { hardMin: 0 }), lenF(it, 'Lane width', 'width', { hardMin: 10, hardMax: 60 })]);
    if (it.kind === 'speed') return els([offF(it, 'x', 'x'), offF(it, 'y', 'y'), lenF(it, 'Width', 'width', { hardMin: 10, hardMax: 60 }), ...(Store.get('ramp.speed.shape') === 'circular' ? [] : [lenF(it, 'Length', 'length', { hardMin: 20 })])]);
    return [];
  }

  function renderCard() {
    const card = $('selection-card');
    if (!card) return;
    card.textContent = '';
    cardFns = []; cardRefs = null;
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    const one = items.length === 1 ? items[0] : null;
    const refs = cardRefs = {};
    const built = Controls.scoped(() => {
      refs.title = h('b', { class: 'sc-name' });
      refs.sub = h('span', { class: 'sc-sub' });
      const clearBtn = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', html: ICON_X, onclick: clear });
      card.append(h('div', { class: 'sc-head' }, h('div', { class: 'sc-titles' }, refs.title, refs.sub), clearBtn));

      const actions = h('div', { class: 'sc-actions' });
      if (one && one.kind === 'core') {
        if (editable(one)) actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'move-to-row', onclick: () => UI.moveCoreById(one.id) }, 'Move to nearest row'));
        else actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'make-editable', onclick: () => { UI.makeCoresEditable(); } }, 'Make the cores editable'));
      }
      if (one) actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'open', onclick: () => UI.openItem(one) }, 'Open in panel'));
      if (items.some((i) => i.kind === 'core' || i.kind === 'entry')) actions.append(h('button', { class: 'btn outline sm danger-text', type: 'button', 'data-action': 'delete', onclick: () => deleteSelection() }, 'Delete'));
      card.append(actions);
      if (one && fieldsFor(one).length) {
        const fields = h('div', { class: 'sc-fields', hidden: !fieldsOpen }, fieldsFor(one));
        const tog = h('button', { class: 'sc-toggle', type: 'button', 'aria-expanded': String(fieldsOpen), html: `<span>Dimensions</span>${CARET_SVG}`, onclick: () => {
          fieldsOpen = !fieldsOpen; fields.hidden = !fieldsOpen; tog.setAttribute('aria-expanded', String(fieldsOpen));
        } });
        card.append(tog, fields);
      }
    });
    cardFns = [...built, () => syncCardText()];
    cardFns.forEach((fn) => fn());
  }
  function syncCardText() {
    if (!cardRefs || !items.length) return;
    if (items.length === 1) { cardRefs.title.textContent = itemName(items[0]); cardRefs.sub.textContent = itemSub(items[0]); }
    else {
      const counts = {};
      for (const i of items) counts[i.kind] = (counts[i.kind] || 0) + 1;
      cardRefs.title.textContent = `${items.length} items`;
      cardRefs.sub.textContent = Object.entries(counts).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ');
    }
  }

  /** Marks the panel rows of the selected items (the other half of the two-way link). */
  const rowItem = (sec, index) => {
    const s = Store.raw();
    if (sec === 'cores') return s.cores[index] ? { kind: 'core', id: s.cores[index].id } : null;
    if (sec === 'entries') return s.entries[index] ? { kind: 'entry', id: s.entries[index].id } : null;
    return null;
  };
  function syncRows() {
    for (const sec of ['cores', 'entries']) {
      document.querySelectorAll(`#sections [data-section="${sec}"] .item[data-index]`).forEach((row) => {
        const it = rowItem(sec, +row.dataset.index);
        row.classList.toggle('sel-row', !!it && items.some((i) => sameItem(i, it)));
      });
    }
  }
  function initPanelLink() {
    $('sections').addEventListener('click', (e) => {
      const head = e.target.closest && e.target.closest('.item-title');
      if (!head) return;
      const row = head.closest('.item[data-index]'), sec = head.closest('[data-section]');
      if (!row || !sec) return;
      const it = rowItem(sec.dataset.section, +row.dataset.index);
      if (!it) return;
      if (e.shiftKey) toggleItem(it); else setItems([it]);
    });
  }

  /* ==========================================================================
     Keyboard (Mac shortcuts)
     ========================================================================== */
  const VIEW_KEYS = { 1: 'axon', 2: 'n', 3: 'e', 4: 's', 5: 'w', 6: 'plan' };
  function typing(e) {
    const t = e.target, a = document.activeElement;
    const inField = (n) => !!n && n.nodeType === 1 && (n.matches('input, textarea, select') || n.isContentEditable);
    return inField(t) || inField(a);
  }
  function menuOpen() {
    return Pop.isOpen() || !!document.querySelector('.modal-back') || !!document.querySelector('.ai-panel[data-open="true"]');
  }
  /** L: isolate the next level (all levels after the last); Shift+L: all levels. */
  function nextLevel(all) {
    const n = D().levels.length;
    const cur = num(Store.get('view.level'), 0);
    const next = all ? 0 : cur >= n ? 0 : cur + 1;
    Store.set('view.level', next, { live: false });
    return next;
  }
  function onKey(e) {
    if (!ready || typing(e) || menuOpen()) return;
    if (Compare.isActive()) return;
    const key = e.key;
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd || e.altKey) return;
    if (key === 'Escape') { if (drag) { endDrag(false); e.preventDefault(); } else if (items.length) { clear(); e.preventDefault(); } return; }
    if (key === 'Delete' || key === 'Backspace') { if (items.length) { e.preventDefault(); deleteSelection(); } return; }
    if (key === 'L') { e.preventDefault(); nextLevel(true); return; }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'diagram' ? 'model' : 'diagram', { live: false }); return; }
    if (key === 'l') { e.preventDefault(); nextLevel(false); }
  }

  /* ==========================================================================
     Init
     ========================================================================== */
  function init() {
    ready = Render.ready();
    if (!$('selection-card')) return;
    initPanelLink();
    Store.subscribe(() => {
      sanitize();
      syncCardText();
      cardFns.forEach((fn) => fn());
      syncRows();
    });
    if (!ready) return;
    initOverlay();
    buildHandleLayer();
    initPointer();
    window.addEventListener('keydown', onKey, true);
    Render.onFrame(syncHandles);
    Render.onRebuild(() => { if (items.length) { sanitize(); refreshOverlay(); } });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener('change', refreshOverlay) : mq.addListener(refreshOverlay));
    window.addEventListener('resize', () => Render.requestRender());
  }

  return {
    init,
    select: (list) => setItems(list), add: (it) => setItems([...items, it]), toggle: toggleItem, clear,
    get: () => items.map((i) => ({ ...i })), count: () => items.length,
    deleteSelection, deleteItems, nextLevel,
    pickAt, click, screenPointFor, visibleHandles, simulateHandleDrag,
    releaseHandleDrag: () => { flushMove(); endDrag(true); },
    cancelHandleDrag: () => endDrag(false),
    dragging: () => !!drag, lastDrag: () => lastDrag,
    handlesShown: () => handlesWanted(),     // read-only: a selection with visible handles (the placement gizmo yields to it)
    onChange: (fn) => listeners.push(fn),
    refreshOverlay,
    overlayInfo: () => ({ outline: outlineGroup ? outlineGroup.children.length : 0, guides: guideGroup ? guideGroup.children.length : 0 }),
    footprint: footprintOf, editable,
  };
})();
