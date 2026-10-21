import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ==========================================================================
   SELECT  (plan section 5.3: direct editing)
   Select by clicking, the selection card, handles, snapping during a drag,
   duplicate, delete and the Mac shortcuts.

   Selection state lives HERE, never in the Store, so it is never saved,
   exported or undone. Every edit goes through the Store: a handle drag is a
   run of live sets that commit as ONE undo step; menu-style edits (program,
   duplicate, delete) are one Store.replace.

   Items:  { kind: 'bar', id } · { kind: 'court', id } · { kind: 'deck' } · { kind: 'podium' } · { kind: 'context', index }

   Handles are DOM elements in a layer over the canvas. They follow the camera
   every drawn frame (Render.onFrame), so they keep a constant size on screen
   and the hit area is simply the element (44 CSS px on touch). The selection
   outline and the snap guides are 3D lines in the Render overlay group
   (hidden in screenshots and in Compare).
     bar      move x, move y, rotate (beyond the end), length (both ends), depth (left side), floors (top)
     deck     move x, move y, width, depth, levels (top)
     court    move x, move y, width, depth
     context  move x, move y, width, depth, height (top)
     podium   no handles: its size follows the mode
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
  const KINDS = ['bar', 'court', 'deck', 'podium', 'context'];
  const fmt = (v) => Units.formatFeetInches(v);
  const rnd = (v, k = 1000) => Math.round(v * k) / k;
  const progLabel = (k) => (CONFIG.programs[k] || {}).label || k;
  const progColor = (k) => ((Store.get(`programs.${k}`) || {}).color) || ((CONFIG.programs[k] || {}).color) || '#999';
  const isCoarse = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const sheetMode = () => !!(window.matchMedia && matchMedia('(max-width: 899px), (orientation: portrait)').matches);
  const planDir = (deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a), Math.sin(a)]; };
  const worldDir = (dx, dy) => new THREE.Vector3(...planToWorld(dx, dy, 0)).normalize();

  let items = [];                            // the selection, in the order it was made
  let addMode = false;                       // "Select more" (touch): taps add to the selection
  let ready = false;                         // Render has a canvas
  let fieldsOpen = !sheetMode();             // the card's Dimensions block (collapsed by default on the bottom sheet)
  let drag = null;                           // the handle drag in progress
  let lastDrag = null;                       // label + guides of the last drag step (tests)
  const listeners = [];

  /* ---- items ------------------------------------------------------------------ */
  const idOf = (it) => (it.id !== undefined ? it.id : it.index);
  const normItem = (it) => {
    if (it.kind === 'bar' || it.kind === 'court') return { kind: it.kind, id: it.id };
    if (it.kind === 'context') return { kind: 'context', index: it.index | 0 };
    return { kind: it.kind };
  };
  const sameItem = (a, b) => a.kind === b.kind && idOf(a) === idOf(b);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const barIndex = (s, id) => s.bars.findIndex((b) => b.id === id);
  const courtIndex = (s, id) => (s.courts || []).findIndex((c) => c.id === id);

  function isValid(it) {
    if (!it || !KINDS.includes(it.kind)) return false;
    const s = Store.raw();
    switch (it.kind) {
      case 'bar': return barIndex(s, it.id) >= 0;
      case 'court': return courtIndex(s, it.id) >= 0;
      case 'deck': return !!s.deck.on;
      case 'podium': return !!s.podium.on;
      case 'context': return it.index >= 0 && it.index < (s.context.blocks || []).length;
      default: return false;
    }
  }
  /** The Store path of the item's record ('bars.0', 'deck', 'courts.1', 'context.blocks.2'), or null once it is gone. */
  function basePath(it) {
    const s = Store.raw();
    switch (it.kind) {
      case 'bar': { const i = barIndex(s, it.id); return i < 0 ? null : `bars.${i}`; }
      case 'court': { const i = courtIndex(s, it.id); return i < 0 ? null : `courts.${i}`; }
      case 'deck': return 'deck';
      case 'podium': return 'podium';
      default: return `context.blocks.${it.index}`;
    }
  }
  function itemName(it) {
    const s = Store.raw();
    switch (it.kind) {
      case 'bar': { const b = s.bars[barIndex(s, it.id)]; return b ? b.name || `Bar ${b.id}` : 'Bar'; }
      case 'court': return `Court ${it.id}`;
      case 'deck': return 'Deck';
      case 'podium': return 'Podium';
      default: return `Context block ${it.index + 1}`;
    }
  }
  function itemSub(it) {
    const s = Store.raw();
    try {
      switch (it.kind) {
        case 'bar': { const b = s.bars[barIndex(s, it.id)]; return `${fmt(b.length)} × ${fmt(b.depth)} · ${b.floors} floors · ${progLabel(b.program)}`; }
        case 'court': { const c = s.courts[courtIndex(s, it.id)]; return `Open court · ${fmt(c.w)} × ${fmt(c.d)}`; }
        case 'deck': return `Parking deck · ${s.deck.levels} levels · ${fmt(s.deck.w)} × ${fmt(s.deck.d)}`;
        case 'podium': return `Podium · ${s.podium.levels.length} ${s.podium.levels.length === 1 ? 'level' : 'levels'}`;
        default: { const b = s.context.blocks[it.index]; return `Context block · ${fmt(num(b.h, 0))} high`; }
      }
    } catch (e) { return it.kind; }
  }

  /** Elevation range { z0, z1 } of an item. */
  function zRange(it) {
    const s = Store.raw(), d = Derived.get();
    if (it.kind === 'bar') {
      const bar = s.bars[barIndex(s, it.id)];
      const lv = bar ? BarsMod.barLevels(bar, s) : [];
      return lv.length ? { z0: lv[0].z, z1: lv[lv.length - 1].z + lv[lv.length - 1].ftf } : null;
    }
    if (it.kind === 'deck' || it.kind === 'podium') {
      const list = d.built.levels.filter((l) => l.zone === it.kind);
      return list.length ? { z0: Math.min(...list.map((l) => l.z)), z1: Math.max(...list.map((l) => l.z + l.ftf)) } : null;
    }
    if (it.kind === 'court') return { z0: 0, z1: 1 };
    const b = s.context.blocks[it.index];
    return b ? { z0: num(b.base, 0), z1: num(b.base, 0) + num(b.h, 0) } : null;
  }

  /* ==========================================================================
     Footprints (the plan box of an item) and the paths that resize a rectangle item
     ========================================================================== */
  const rectBox = (r) => ({ minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minY: r.y - r.d / 2, maxY: r.y + r.d / 2 });
  function footprint(it) {
    const s = Store.raw(), d = Derived.get();
    if (it.kind === 'bar') {
      const b = SnapTargetsMod.barBox(s, d.built, it.id);
      return b ? { box: b, resize: false } : null;
    }
    if (it.kind === 'podium') {
      const lv = d.built.levels.filter((l) => l.zone === 'podium');
      const b = lv.length ? boxOfPolys(lv[0].plates) : null;
      return b ? { box: b, resize: false } : null;
    }
    const p = basePath(it);
    const r = p && Store.get(p);
    if (!r) return null;
    const rect = { x: num(r.x, 0), y: num(r.y, 0), w: num(r.w, 0), d: num(r.d, 0) };
    return { box: rectBox(rect), resize: true };
  }
  /** [path, value] writes that set a plan extent along `axis` ('x' | 'y') of a rectangle item; the new center is given. */
  function extentWrites(it, axis, extent, center) {
    const base = basePath(it);
    return axis === 'x' ? [[`${base}.w`, extent], [`${base}.x`, center]] : [[`${base}.d`, extent], [`${base}.y`, center]];
  }
  const exclusion = (it) => (it.kind === 'bar' || it.kind === 'court' ? { kind: it.kind, id: it.id } : it.kind === 'context' ? { kind: 'context', index: it.index } : { kind: it.kind });

  /* ==========================================================================
     Picking: invisible proxy meshes (one per item), raycast on a click
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
  function mergeInto(meshes, geos, item, rank) {
    const list = geos.filter((g) => g && g.getAttribute('position') && g.getAttribute('position').count);
    if (!list.length) return;
    const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
    if (list.length > 1) list.forEach((g) => g.dispose());
    if (!merged) return;
    const m = new THREE.Mesh(merged, pickMat);
    m.userData.item = item; m.userData.rank = rank;
    meshes.push(m);
  }
  function disposePick() {
    if (!pickCache) return;
    pickCache.meshes.forEach((m) => m.geometry.dispose());
    pickCache = null;
  }
  function pickSet() {
    const d = Derived.get(), s = Store.raw();
    const key = [d.id, s.context.show ? 1 : 0].join('|');
    if (pickCache && pickCache.key === key) return pickCache;
    disposePick();
    const meshes = [];
    for (const bar of s.bars) {
      const lv = BarsMod.barLevels(bar, s);
      if (!lv.length) continue;
      const z0 = lv[0].z, z1 = lv[lv.length - 1].z + lv[lv.length - 1].ftf;
      const geos = [];
      for (const leg of BarsMod.legsOf(bar)) { try { geos.push(extrude([{ outer: BarsMod.legRing(leg), holes: [] }], z0, z1 - z0)); } catch (e) { /* skip */ } }
      mergeInto(meshes, geos, { kind: 'bar', id: bar.id }, 0);
    }
    for (const zone of ['deck', 'podium']) {
      const geos = [];
      for (const l of d.built.levels) if (l.zone === zone && l.plates.length) { try { geos.push(extrude(l.plates, l.z, l.ftf)); } catch (e) { /* skip */ } }
      mergeInto(meshes, geos, { kind: zone }, 0);
    }
    for (const c of s.courts || []) {
      const w = num(c.w, 0), dd = num(c.d, 0);
      if (!(w > 0 && dd > 0)) continue;
      try { mergeInto(meshes, [extrude([{ outer: rectRingAt(num(c.x, 0), num(c.y, 0), w, dd), holes: [] }], 0, 1)], { kind: 'court', id: c.id }, 0); } catch (e) { /* skip */ }
    }
    if (s.context.show && s.context.blocks) {
      s.context.blocks.forEach((b, i) => {
        const w = num(b.w, 0), dd = num(b.d, 0), hh = num(b.h, 0);
        if (!(w > 0 && dd > 0 && hh > 0)) return;
        const geo = new THREE.BoxGeometry(w, dd, hh);
        geo.translate(num(b.x, 0), num(b.y, 0), num(b.base, 0) + hh / 2);
        geo.applyMatrix4(planMatrix(0));
        mergeInto(meshes, [geo], { kind: 'context', index: i }, 1);
      });
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
  /** The item under a screen point (client px), or null. Model items win over context blocks (the blocks are see-through). */
  function pickAt(cx, cy) {
    if (!ready || Render.comparing()) return null;
    setRay(cx, cy);
    const hits = raycaster.intersectObjects(pickSet().meshes, false);
    let ctx = null;
    for (const hit of hits) {
      if (hit.object.userData.rank === 1) { if (!ctx) ctx = hit.object.userData.item; continue; }
      return { ...hit.object.userData.item };
    }
    return ctx ? { ...ctx } : null;
  }
  const toClient = (v3) => {
    const rect = canvasRect(), p = v3.clone().project(camera());
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, z: p.z };
  };
  /** A client point where the item can be picked (the projected center of its volume, searched outward). Used by tests. */
  function screenPointFor(it) {
    if (!ready) return null;
    const fp = footprint(it), r = zRange(it);
    if (!fp || !r) return null;
    const box = fp.box;
    const fr = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (const fz of fr) for (const fx of fr) for (const fy of fr) {
      const p = toClient(worldVec(box.minX + (box.maxX - box.minX) * fx, box.minY + (box.maxY - box.minY) * fy, r.z0 + (r.z1 - r.z0) * fz));
      if (p.z < -1 || p.z > 1) continue;
      const hit = pickAt(p.x, p.y);
      if (hit && sameItem(hit, normItem(it))) return { x: p.x, y: p.y };
    }
    return null;
  }

  /* ==========================================================================
     Overlay: selection outline and snap guides (3D lines)
     ========================================================================== */
  let outlineGroup = null, guideGroup = null, lotGroup = null;
  let mOutline = null, mHalo = null, mGhost = null, mGuide = null, mSheet = null;
  const cssColorOf = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

  function initOverlay() {
    const root = Render.overlayGroup();
    outlineGroup = new THREE.Group(); guideGroup = new THREE.Group(); lotGroup = new THREE.Group();
    root.add(outlineGroup, guideGroup, lotGroup);
    // Fat lines (a few CSS px wide): a hairline accent outline vanishes on the saturated Diagram colors.
    const fatMat = (o) => new LineMaterial({ color: 0x23508f, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...o });
    mGhost = fatMat({ linewidth: 1.25, opacity: 0.3, depthTest: false });
    mHalo = fatMat({ linewidth: 4.25, opacity: 0.9, depthTest: true });
    mOutline = fatMat({ linewidth: 2, opacity: 1, depthTest: true });
    mGuide = new THREE.LineDashedMaterial({ color: GUIDE_COLOR, dashSize: 6, gapSize: 4, depthTest: false, transparent: true });
    mSheet = new THREE.MeshBasicMaterial({ color: GUIDE_COLOR, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  }
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
  function pushOutline(pos, it) {
    const s = Store.raw(), d = Derived.get();
    const r = zRange(it);
    if (!r) return;
    if (it.kind === 'bar') {
      const bar = s.bars[barIndex(s, it.id)];
      for (const leg of BarsMod.legsOf(bar)) pushEdges(pos, extrude([{ outer: BarsMod.legRing(leg), holes: [] }], r.z0, r.z1 - r.z0));
    } else if (it.kind === 'deck' || it.kind === 'podium') {
      for (const l of d.built.levels) if (l.zone === it.kind && l.plates.length) pushEdges(pos, extrude(l.plates, l.z, l.ftf));
    } else if (it.kind === 'court') {
      const c = s.courts[courtIndex(s, it.id)];
      if (c) pushEdges(pos, extrude([{ outer: rectRingAt(num(c.x, 0), num(c.y, 0), num(c.w, 0), num(c.d, 0)), holes: [] }], 0.1, 0.6));
    } else {
      const b = s.context.blocks[it.index];
      if (!b) return;
      const geo = new THREE.BoxGeometry(num(b.w, 0), num(b.d, 0), num(b.h, 0));
      geo.translate(num(b.x, 0), num(b.y, 0), num(b.base, 0) + num(b.h, 0) / 2);
      geo.applyMatrix4(planMatrix(0));
      pushEdges(pos, geo);
    }
  }
  function refreshOverlay() {
    if (!ready || !outlineGroup) return;
    clearGroup(outlineGroup);
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
  function showGuides(guides, zTop) {
    clearGroup(guideGroup);
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
     Handles
     ========================================================================== */
  let layer = null, labelEl = null;
  const hEls = {};
  const HANDLE_DEFS = [
    ['move-x', 'move', 'Move east or west'],
    ['move-y', 'move', 'Move north or south'],
    ['rotate', 'rotate', 'Rotate the bar'],
    ['len-end', 'resize', 'Change the length at the end'],
    ['len-start', 'resize', 'Change the length at the start'],
    ['width', 'resize', 'Change the width'],
    ['depth', 'resize', 'Change the depth'],
    ['top', 'top', 'Change the height or the number of floors'],
  ];
  const GLYPH = {
    move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>',
    resize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M7 12h13M16 8l4 4-4 4"/></svg>',
    top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12M12 20V9M7 13l5-5 5 5"/></svg>',
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
    if (!['bar', 'deck', 'court', 'context'].includes(it.kind)) return null;
    const s = Store.raw();
    const fp = footprint(it), r = zRange(it);
    if (!fp || !r) return null;
    const { z0, z1 } = r;
    const b = fp.box, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const hs = [
      { id: 'move-x', kind: 'move', anchor: worldVec(cx, b.minY, z0), axis: AX, out: AY.clone().negate() },
      { id: 'move-y', kind: 'move', anchor: worldVec(b.minX, cy, z0), axis: AY, out: AX.clone().negate() },
    ];
    if (it.kind === 'bar') {
      const bar = s.bars[barIndex(s, it.id)];
      const legs = BarsMod.legsOf(bar), verts = barVertices(bar);
      const first = legs[0], last = legs[legs.length - 1];
      const dF = planDir(first.angle), dL = planDir(last.angle);
      const end = verts[verts.length - 1], start = verts[0];
      hs.push({ id: 'rotate', kind: 'rotate', anchor: worldVec(end[0], end[1], z0), axis: AX, out: worldDir(dL[0], dL[1]), flat: true, far: 30 });
      hs.push({ id: 'len-end', kind: 'resize', anchor: worldVec(end[0], end[1], z1), axis: worldDir(dL[0], dL[1]), out: worldDir(dL[0], dL[1]) });
      if (legs.length === 1) hs.push({ id: 'len-start', kind: 'resize', anchor: worldVec(start[0], start[1], z1), axis: worldDir(dF[0], dF[1]), out: worldDir(-dF[0], -dF[1]) });
      const nL = [-dF[1], dF[0]];
      const mid = [start[0] + dF[0] * first.length / 2 + nL[0] * bar.depth / 2, start[1] + dF[1] * first.length / 2 + nL[1] * bar.depth / 2];
      hs.push({ id: 'depth', kind: 'resize', anchor: worldVec(mid[0], mid[1], z1), axis: worldDir(nL[0], nL[1]), out: worldDir(nL[0], nL[1]) });
      let longest = legs[0], li = 0;
      legs.forEach((l, i) => { if (l.length > longest.length) { longest = l; li = i; } });
      const pa = verts[li], pb = verts[li + 1];
      hs.push({ id: 'top', kind: 'top', anchor: worldVec((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, z1), axis: AZ, out: null });
    } else {
      hs.push({ id: 'width', kind: 'resize', anchor: worldVec(b.maxX, cy, z1), axis: AX, out: AX });
      hs.push({ id: 'depth', kind: 'resize', anchor: worldVec(cx, b.maxY, z1), axis: AY, out: AY });
      if (it.kind !== 'court') hs.push({ id: 'top', kind: 'top', anchor: worldVec(cx, cy, z1), axis: AZ, out: null });
    }
    return { item: it, fp, z0, z1, hs };
  }
  function handlesWanted() {
    return ready && items.length === 1 && ['bar', 'deck', 'court', 'context'].includes(items[0].kind) && !Render.comparing();
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
      if (hd.kind === 'top') { if (elevation) oy = -(coarse ? 30 : 24); }
      else if (hd.kind === 'move' && elevation) oy = coarse ? 32 : 26;
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
      el.firstChild.firstChild.style.transform = (hd.kind === 'top' || hd.kind === 'rotate') ? '' : `rotate(${ang.toFixed(1)}deg)`;
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
  const snapSettings = () => { const sn = Store.get('view.snap') || {}; return { on: sn.on !== false, grid: sn.grid === 10 ? 10 : 5 }; };

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
  /** The plan point under the pointer on the horizontal plane at `elev` (for the rotate handle), or null. */
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
    const s = Store.raw(), d = Derived.get();
    const touch = !!opt.touch;
    const f = viewDirAt(hd.anchor);
    const n = f.clone().addScaledVector(hd.axis, -f.dot(hd.axis));
    if (id !== 'rotate' && n.lengthSq() < 1e-8) return false;
    n.normalize();
    const box = info.fp.box;
    drag = {
      id, item: it, info, fp: info.fp, p0: hd.anchor.clone(), axis: hd.axis.clone(), n, t0: 0, elev: info.z0,
      snapBox: SnapTargetsMod.midriseItemBox(s, d.built, it) || box,
      pointerId: opt.pointerId, touch, orig: {}, pending: null, raf: 0,
      targets: SnapTargetsMod.collectBarSnapTargets(s, d.built, { exclude: exclusion(it) }),
      tol: clamp(ftPerPx(worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0)) * (touch ? TOL_PX_TOUCH : TOL_PX), 0.5, 20),
      base: clone(Store.get(basePath(it))),
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
  /** Moves a point along a plan direction by t, snapping its coordinate to a guide line when the direction is a plan axis. → { t, guide } */
  function snapAlong(p0, dir, t, enabled, span) {
    const ax = Math.abs(dir[0]) > 0.9999 ? 'x' : Math.abs(dir[1]) > 0.9999 ? 'y' : null;
    if (!ax || !enabled) return { t, guide: null };
    const k = ax === 'x' ? dir[0] : dir[1], i = ax === 'x' ? 0 : 1;
    const r = SnapMod.snapEdge(p0[i] + k * t, ax, drag.targets, { tolerance: drag.tol, grid: 0, enabled, span });
    return r.guide && r.guide.kind !== 'grid' ? { t: (r.value - p0[i]) / k, guide: r.guide } : { t, guide: null };
  }
  function dragMove(cx, cy, alt) {
    if (!drag) return null;
    const sn = snapSettings();
    const enabled = sn.on && !alt;
    const it = drag.item, id = drag.id, base = drag.base;
    const bp = basePath(it);
    if (!bp) return lastDrag;
    const isBar = it.kind === 'bar';
    let label = '', guides = [];

    if (id === 'rotate') {
      const p = pointerPlan(cx, cy, drag.elev);
      if (!p) return lastDrag;
      let ang = (Math.atan2(p[1] - num(base.y, 0), p[0] - num(base.x, 0)) * 180) / Math.PI;
      ang = enabled ? Math.round(ang / 5) * 5 : Math.round(ang * 10) / 10;
      if (ang > 180) ang -= 360; if (ang <= -180) ang += 360;
      write(`${bp}.angle`, ang);
      label = `Angle ${ang}°`;
    } else {
      const t0 = pointerParam(cx, cy);
      if (t0 == null) return lastDrag;
      const t = t0 - drag.t0;
      if (id === 'move-x' || id === 'move-y') {
        const ax = id === 'move-x' ? 'x' : 'y';
        const res = SnapMod.snapMove(drag.snapBox, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, { tolerance: drag.tol, grid: sn.grid, enabled });
        let delta = ax === 'x' ? res.dx : res.dy;
        if (!enabled) delta = rnd(t, 10);
        guides = res.guides.filter((g) => g.axis === ax && g.kind !== 'grid');
        const v = rnd(num(base[ax], 0) + delta, 10000);
        write(`${bp}.${ax}`, v);
        label = `${it.kind === 'bar' ? 'Start' : 'Center'} ${ax} ${fmt(v)}`;
      } else if (isBar && (id === 'len-end' || id === 'len-start')) {
        const legs = BarsMod.legsOf(base), verts = barVertices(base);
        const leg = id === 'len-end' ? legs[legs.length - 1] : legs[0];
        const dir = planDir(leg.angle);
        const p0 = id === 'len-end' ? verts[verts.length - 1] : verts[0];
        const L0 = num(base.length, 0);
        const edge = snapAlong(p0, dir, t, enabled, null);                 // the handle point moves along the bar direction by t
        let dl = edge.guide ? edge.t : t;
        let len = id === 'len-end' ? L0 + dl : L0 - dl;
        if (!edge.guide) len = SnapMod.snapLength(len, { step: enabled ? 1 : 0.1 });
        len = clamp(len, 1, MAXD);
        if (edge.guide) guides = [edge.guide];
        write(`${bp}.length`, rnd(len, 10000));
        if (id === 'len-start') {
          const shift = L0 - len;                                            // how far the start moved along the bar
          write(`${bp}.x`, rnd(num(base.x, 0) + dir[0] * shift, 10000));
          write(`${bp}.y`, rnd(num(base.y, 0) + dir[1] * shift, 10000));
        }
        label = `Length ${fmt(len)}`;
      } else if (isBar && id === 'depth') {
        const a = planDir(num(base.angle, 0)), nrm = [-a[1], a[0]];
        const D0 = num(base.depth, 0);
        // the left edge follows the pointer, the right edge stays: the centerline shifts by half the change
        const e0 = [num(base.x, 0) + nrm[0] * D0 / 2, num(base.y, 0) + nrm[1] * D0 / 2];
        const edge = (base.bends || []).length ? { t, guide: null } : snapAlong(e0, nrm, t, enabled, null);
        let dd = D0 + (edge.guide ? edge.t : t);
        if (!edge.guide) dd = SnapMod.snapLength(dd, { step: enabled ? 1 : 0.1 });
        dd = clamp(dd, 10, MAXD);
        if (edge.guide) guides = [edge.guide];
        const shift = (dd - D0) / 2;
        write(`${bp}.depth`, rnd(dd, 10000));
        write(`${bp}.x`, rnd(num(base.x, 0) + nrm[0] * shift, 10000));
        write(`${bp}.y`, rnd(num(base.y, 0) + nrm[1] * shift, 10000));
        label = `Depth ${fmt(dd)}`;
      } else if (id === 'width' || id === 'depth') {
        const ax = id === 'width' ? 'x' : 'y';
        const box = drag.fp.box;
        const lo = ax === 'x' ? box.minX : box.minY, hi = ax === 'x' ? box.maxX : box.maxY;
        const span = ax === 'x' ? { from: box.minY, to: box.maxY } : { from: box.minX, to: box.maxX };
        const r = SnapMod.snapEdge(hi + t, ax, drag.targets, { tolerance: drag.tol, grid: 0, enabled, span });
        let ext = r.value - lo;
        if (!r.guide) ext = SnapMod.snapLength(ext, { step: enabled ? 1 : 0.1 });
        ext = clamp(ext, 1, MAXD);
        if (r.guide && r.guide.kind !== 'grid') guides = [r.guide];
        const center = lo + ext / 2;
        for (const [path, v] of extentWrites(it, ax, rnd(ext, 10000), rnd(center, 10000))) write(path, v);
        label = `${id === 'width' ? 'Width' : 'Depth'} ${fmt(ext)}`;
      } else if (id === 'top') {
        if (it.kind === 'context') {
          const hh = clamp(SnapMod.snapLength(num(base.h, 0) + t, { step: enabled ? 1 : 0.1 }), 1, MAXD);
          write(`${bp}.h`, hh);
          label = `Height ${fmt(hh)}`;
        } else if (it.kind === 'deck') {
          const ftf = Math.max(1, num(base.ftf, 10.5));
          const n = clamp(Math.max(1, Math.round(num(base.levels, 1)) + Math.round(t / ftf)), 1, CONFIG.limits.maxFloors);
          write(`${bp}.levels`, n);
          label = `${n} ${n === 1 ? 'level' : 'levels'} · ${fmt(n * ftf)}`;
        } else {
          // one floor per floor-to-floor of drag (10 ft by default)
          const ftf = Math.max(1, num(Store.get('floors.ftf'), 10));
          const n = clamp(Math.max(1, Math.round(num(base.floors, 1)) + Math.round(t / ftf)), 1, CONFIG.limits.maxFloors);
          write(`${bp}.floors`, n);
          label = `${n} ${n === 1 ? 'floor' : 'floors'}`;
        }
      }
    }
    lastDrag = { id, label, guides: guides.map((g) => ({ axis: g.axis, value: g.value, kind: g.kind, label: g.label })) };
    showGuides(guides, drag.info.z1);
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
   *  simulateHandleDrag('move-x', dx) · ('move-y', 0, dy) · ('len-end', dl) · ('len-start', dl) · ('depth', dd) · ('width', dx) · ('top', 0, dz)
   *  · ('rotate', angleDegrees); opts { alt, hold }. With hold the drag stays open (guides and label stay on screen) until releaseHandleDrag(). */
  function simulateHandleDrag(id, a = 0, b = 0, opts = {}) {
    if (!ready) return null;
    if (drag) endDrag(true);
    const info = items.length === 1 ? handleInfo(items[0]) : null;
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return null;
    let target;
    if (id === 'rotate') {
      const it = items[0], base = Store.get(basePath(it));
      const rad = (a * Math.PI) / 180, R = 100;
      target = worldVec(num(base.x, 0) + R * Math.cos(rad), num(base.y, 0) + R * Math.sin(rad), info.z0);
    } else {
      const amount = (id === 'move-x' || id === 'width' || id === 'len-end' || id === 'len-start') ? a : (b !== 0 ? b : a);
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
    if (!items.length) addMode = false;
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
  /** Drops items that no longer exist (undo, delete, the deck turned off). */
  function sanitize() {
    const kept = items.filter(isValid);
    if (kept.length !== items.length) { items = kept; if (!items.length) addMode = false; if (drag) endDrag(false); onChanged(); return true; }
    return false;
  }

  function deleteItems(list) {
    const sel = (list || items).map(normItem).filter(isValid);
    if (!sel.length) return 0;
    const next = clone(Store.raw());
    let removed = 0;
    const barIds = new Set(sel.filter((i) => i.kind === 'bar').map((i) => i.id));
    if (barIds.size && barIds.size >= next.bars.length) {
      const keep = next.bars[0].id;                         // never delete the last bar: the first one stays
      barIds.delete(keep);
      Toast.show('A design needs at least one bar, so one was kept.', 'warn');
    }
    if (barIds.size) { next.bars = next.bars.filter((b) => !barIds.has(b.id)); removed += barIds.size; }
    const courtIds = new Set(sel.filter((i) => i.kind === 'court').map((i) => i.id));
    if (courtIds.size) { next.courts = next.courts.filter((c) => !courtIds.has(c.id)); removed += courtIds.size; }
    for (const i of [...new Set(sel.filter((x) => x.kind === 'context').map((x) => x.index))].sort((a, b) => b - a)) { next.context.blocks.splice(i, 1); removed++; }
    if (sel.some((x) => x.kind === 'deck') && next.deck.on) { next.deck.on = false; removed++; }
    if (sel.some((x) => x.kind === 'podium') && next.podium.on) { next.podium.on = false; removed++; }
    if (!removed) return 0;
    Store.replace(next);
    setItems([]);
    return removed;
  }
  function deleteSelection() { return deleteItems(items); }

  function duplicateBar(id) {
    const s = Store.raw();
    const bar = s.bars[barIndex(s, id)];
    if (!bar) return false;
    const copy = duplicateBarOf(s, bar);
    const next = clone(s);
    next.bars.splice(barIndex(s, id) + 1, 0, copy);
    Store.replace(next);
    setItems([{ kind: 'bar', id: copy.id }]);
    return copy.id;
  }
  function addBar() {
    const s = Store.raw();
    if (s.bars.length >= CONFIG.limits.maxBars) { Toast.show(`A design holds up to ${CONFIG.limits.maxBars} bars.`, 'warn'); return false; }
    const bar = newBarFor(s);
    const next = clone(s);
    next.bars.push(bar);
    Store.replace(next);
    setItems([{ kind: 'bar', id: bar.id }]);
    return bar.id;
  }

  /* ==========================================================================
     Lot drawing: click corners on the ground, then finish (Enter, double-click or the Finish lot button)
     ========================================================================== */
  let lotPts = null;
  const lotListeners = [];
  const lotNotify = () => lotListeners.forEach((fn) => { try { fn(!!lotPts); } catch (e) { console.error(e); } });
  function lotSnap(p) {
    const sn = snapSettings();
    const g = sn.on ? sn.grid : 0.5;
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  }
  function drawLot() {
    if (!lotGroup) return;
    clearGroup(lotGroup);
    if (lotPts && lotPts.length) {
      const P = (q) => planToWorld(q[0], q[1], 0.6);
      const seg = [], cross = [];
      const n = lotPts.length;
      if (n >= 2) for (let i = 0; i < n; i++) { if (i === n - 1 && n < 3) break; seg.push(...P(lotPts[i]), ...P(lotPts[(i + 1) % n])); }
      for (const q of lotPts) { cross.push(...P([q[0] - 4, q[1]]), ...P([q[0] + 4, q[1]]), ...P([q[0], q[1] - 4]), ...P([q[0], q[1] + 4])); }
      fat(lotGroup, seg, mOutline, 15);
      lines(lotGroup, cross, mGuide, 16, true);
    }
    Render.requestRender();
  }
  function startLot() {
    if (!ready) return false;
    if (drag) endDrag(false);
    clear();
    lotPts = [];
    drawLot(); lotNotify();
    const cv = Render.canvas(); if (cv) cv.style.cursor = 'crosshair';
    Toast.show('Click the lot corners on the ground. Double-click or press Enter to finish. Esc cancels.', '', 6000);
    return true;
  }
  function addLotPoint(cx, cy) {
    if (!lotPts) return false;
    const q = pointerPlan(cx, cy, 0);
    if (!q) return false;
    const p = lotSnap(q), last = lotPts[lotPts.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5) return false;
    lotPts.push(p);
    drawLot();
    return true;
  }
  /** Ends lot drawing. With commitIt, three or more corners become surface.lot (one undo step). Returns true when a lot was written. */
  function finishLot(commitIt = true) {
    if (!lotPts) return false;
    const pts = lotPts;
    lotPts = null;
    const cv = Render.canvas(); if (cv) cv.style.cursor = '';
    drawLot(); lotNotify();
    if (!commitIt) return false;
    if (pts.length < 3) { Toast.show('A lot needs at least 3 corners, so it was not drawn.', 'warn'); return false; }
    Store.set('surface.lot', pts, { live: false });
    return true;
  }

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
      if (lotPts) { finishLot(true); return; }
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) { setItems([hit]); UI.openItem(hit); }
    });
  }
  function click(cx, cy, shift) {
    if (lotPts) { addLotPoint(cx, cy); return null; }
    const hit = pickAt(cx, cy);
    const additive = shift || addMode;
    if (hit) { if (additive) toggleItem(hit); else setItems([hit]); }
    else if (!additive) clear();
    return hit;
  }

  /* ==========================================================================
     Selection card (#selection-card)
     ========================================================================== */
  let cardFns = [], cardRefs = null;
  /** A store bind for a field of the selected item, found by its id each time (so reordering the bars never breaks the card). */
  const bindItem = (it, sub) => ({
    get: () => { const p = basePath(it); return p ? Store.get(`${p}.${sub}`) : undefined; },
    set: (v, live) => { const p = basePath(it); if (p) Store.set(`${p}.${sub}`, v, { live }); },
    commit: () => Store.commit(),
  });
  const lenF = (it, label, sub, extra = {}) => Controls.slider({
    label, bind: bindItem(it, sub), min: 0, max: 1, step: 1, hardMin: 1, hardMax: MAXD, format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', compact: true, ...extra,
  });
  const offF = (it, label, sub) => lenF(it, label, sub, { hardMin: -MAXD });
  const intF = (it, label, sub, extra = {}) => Controls.slider({
    label, bind: bindItem(it, sub), min: 0, max: 1, step: 1, hardMin: 1, hardMax: CONFIG.limits.maxFloors, integer: true, format: Units.formatInt, inputMode: 'numeric', compact: true, ...extra,
  });
  const degF = (it, label, sub) => Controls.slider({
    label, bind: bindItem(it, sub), min: 0, max: 1, step: 1, hardMin: -360, hardMax: 360, format: (v) => `${Math.round(v * 10) / 10}°`, inputMode: 'decimal', compact: true,
  });

  function fieldsFor(it) {
    const els = (list) => list.map((c) => c.el || c);
    if (it.kind === 'bar') {
      return els([offF(it, 'Start x', 'x'), offF(it, 'Start y', 'y'), degF(it, 'Angle', 'angle'), lenF(it, 'Length', 'length'), lenF(it, 'Depth', 'depth', { hardMin: 10 }), intF(it, 'Floors', 'floors')]);
    }
    if (it.kind === 'deck') {
      return els([offF(it, 'Center x', 'x'), offF(it, 'Center y', 'y'), lenF(it, 'Width', 'w'), lenF(it, 'Depth', 'd'), intF(it, 'Levels', 'levels'), lenF(it, 'FTF', 'ftf', { step: 0.5, hardMin: 6 })]);
    }
    if (it.kind === 'court') return els([offF(it, 'Center x', 'x'), offF(it, 'Center y', 'y'), lenF(it, 'Width', 'w'), lenF(it, 'Depth', 'd')]);
    if (it.kind === 'context') return els([offF(it, 'Center x', 'x'), offF(it, 'Center y', 'y'), lenF(it, 'Width', 'w'), lenF(it, 'Depth', 'd'), lenF(it, 'Height', 'h')]);
    return [];
  }

  const PROGRAM_KEYS = () => CONFIG.barPrograms;
  const barItems = () => items.filter((i) => i.kind === 'bar');
  function programRow() {
    const row = h('div', { class: 'sc-prog', role: 'group', 'aria-label': 'Program' });
    const btns = PROGRAM_KEYS().map((k) => {
      const dot = h('span', { class: 'sc-dot', 'aria-hidden': 'true' });
      const b = h('button', { class: 'sc-pbtn', type: 'button', 'data-program': k, 'aria-pressed': 'false', title: progLabel(k), onclick: () => { UI.setProgramForItems(barItems(), k); } }, dot, progLabel(k));
      row.append(b);
      return { b, dot, k };
    });
    const refresh = () => {
      const s = Store.raw();
      const vals = barItems().map((i) => (s.bars[barIndex(s, i.id)] || {}).program);
      const common = vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
      btns.forEach(({ b, dot, k }) => { b.setAttribute('aria-pressed', String(common === k)); dot.style.background = progColor(k); });
    };
    return { el: h('div', { class: 'sc-prog-wrap' }, row), refresh };
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
    const extra = [];
    const built = Controls.scoped(() => {
      refs.title = h('b', { class: 'sc-name' });
      refs.sub = h('span', { class: 'sc-sub' });
      const clearBtn = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', html: ICON_X, onclick: clear });
      refs.more = h('button', { class: 'btn outline sm sc-more', type: 'button', 'data-action': 'more', 'aria-pressed': String(addMode), title: 'Tap items to add them to the selection', onclick: () => { addMode = !addMode; refs.more.setAttribute('aria-pressed', String(addMode)); } }, 'Select more');
      card.append(h('div', { class: 'sc-head' }, h('div', { class: 'sc-titles' }, refs.title, refs.sub), refs.more, clearBtn));

      if (barItems().length) {
        const r = programRow();
        card.append(r.el); extra.push(r.refresh);
      }
      const actions = h('div', { class: 'sc-actions' });
      if (one && one.kind === 'bar') {
        actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'duplicate', onclick: () => duplicateBar(one.id) }, 'Duplicate'));
      }
      if (one) actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'open', onclick: () => UI.openItem(one) }, 'Open in panel'));
      actions.append(h('button', { class: 'btn outline sm danger-text', type: 'button', 'data-action': 'delete', onclick: () => deleteSelection() }, 'Delete'));
      card.append(actions);
      if (one && fieldsFor(one).length) {
        const fields = h('div', { class: 'sc-fields', hidden: !fieldsOpen }, fieldsFor(one));
        const tog = h('button', { class: 'sc-toggle', type: 'button', 'aria-expanded': String(fieldsOpen), html: `<span>Dimensions</span>${CARET_SVG}`, onclick: () => {
          fieldsOpen = !fieldsOpen; fields.hidden = !fieldsOpen; tog.setAttribute('aria-expanded', String(fieldsOpen));
        } });
        card.append(tog, fields);
      }
    });
    cardFns = [...built, ...extra, () => syncCardText()];
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
    if (sec === 'bars') return s.bars[index] ? { kind: 'bar', id: s.bars[index].id } : null;
    if (sec === 'courts') return s.courts[index] ? { kind: 'court', id: s.courts[index].id } : null;
    if (sec === 'context') return { kind: 'context', index };
    return null;
  };
  function syncRows() {
    for (const sec of ['bars', 'courts', 'context']) {
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
      if (e.shiftKey || addMode) toggleItem(it); else setItems([it]);
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
  function onKey(e) {
    if (!ready || typing(e) || menuOpen()) return;
    if (Compare.isActive()) return;
    const key = e.key;
    const cmd = e.metaKey || e.ctrlKey;
    if (lotPts) {
      if (key === 'Escape') { e.preventDefault(); finishLot(false); } else if (key === 'Enter') { e.preventDefault(); finishLot(true); }
      return;
    }
    if (cmd && !e.altKey && !e.shiftKey && key.toLowerCase() === 'd') {
      e.preventDefault();
      if (items.length === 1 && items[0].kind === 'bar') duplicateBar(items[0].id);
      else Toast.show('Select one bar to duplicate it.', '', 2200);
      return;
    }
    if (cmd || e.altKey) return;
    if (key === 'Escape') { if (drag) { endDrag(false); e.preventDefault(); } else if (items.length) { clear(); e.preventDefault(); } return; }
    if (key === 'Delete' || key === 'Backspace') { if (items.length) { e.preventDefault(); deleteSelection(); } return; }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'diagram' ? 'model' : 'diagram', { live: false }); return; }
    if (key === 'b' || key === 'B') { e.preventDefault(); addBar(); }
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
    Render.onRebuild(() => { if (items.length) refreshOverlay(); });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener('change', refreshOverlay) : mq.addListener(refreshOverlay));
    window.addEventListener('resize', () => Render.requestRender());
  }

  return {
    init,
    select: (list) => setItems(list), add: (it) => setItems([...items, it]), toggle: toggleItem, clear,
    get: () => items.map((i) => ({ ...i })), count: () => items.length,
    deleteSelection, deleteItems, duplicateBar, addBar,
    pickAt, click, screenPointFor, visibleHandles, simulateHandleDrag,
    releaseHandleDrag: () => { flushMove(); endDrag(true); },
    cancelHandleDrag: () => endDrag(false),
    dragging: () => !!drag, lastDrag: () => lastDrag,
    setAddMode: (v) => { addMode = !!v; if (cardRefs && cardRefs.more) cardRefs.more.setAttribute('aria-pressed', String(addMode)); },
    addMode: () => addMode,
    onChange: (fn) => listeners.push(fn),
    startLot, finishLot, lotActive: () => !!lotPts, onLot: (fn) => lotListeners.push(fn), addLotPoint,
    refreshOverlay,
    overlayInfo: () => ({ outline: outlineGroup ? outlineGroup.children.length : 0, guides: guideGroup ? guideGroup.children.length : 0 }),
    footprint,
  };
})();
