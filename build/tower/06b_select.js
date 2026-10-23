//@@MODULE snap@@
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ==========================================================================
   SELECT  (v1.1 direct editing)
   Select by clicking, the selection card, handles, snapping during a drag,
   copy above / below, delete and the Mac shortcuts.

   Selection state lives HERE, never in the Store, so it is never saved,
   exported or undone. Every edit goes through the Store: a handle drag is a
   run of live sets that commit as ONE undo step; menu-style edits (program,
   copy, delete) are one Store.replace.

   Items are { kind: 'segment' | 'podium' | 'crown' | 'carve' | 'context', index }
   (podium and crown have index 0).

   Handles are DOM elements in a layer over the canvas. They follow the camera
   every drawn frame (Render.onFrame), so they keep a constant size on screen
   and the hit area is simply the element (44 CSS px on touch). The selection
   outline, the carve outlines and the snap guides are 3D lines in the
   Render overlay group (hidden in screenshots and in Compare).
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
  const KINDS = ['segment', 'podium', 'crown', 'carve', 'context'];
  const fmt = (v) => Units.formatFeetInches(v);
  const rnd = (v, k = 1000) => Math.round(v * k) / k;
  const progLabel = (k) => (CONFIG.programs[k] || {}).label || k;
  const progColor = (k) => ((Store.get(`programs.${k}`) || {}).color) || ((CONFIG.programs[k] || {}).color) || '#999';
  const isCoarse = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const sheetMode = () => !!(window.matchMedia && matchMedia('(max-width: 899px), (orientation: portrait)').matches);

  let items = [];                            // the selection, in the order it was made
  let addMode = false;                       // "Select more" (touch): taps add to the selection
  let ready = false;                         // Render has a canvas
  let fieldsOpen = !sheetMode();             // the card's Dimensions block (collapsed by default on the bottom sheet)
  let drag = null;                           // the handle drag in progress
  let lastDrag = null;                       // label + guides of the last drag step (tests)
  const listeners = [];

  /* ---- items ------------------------------------------------------------------ */
  const single = (kind) => (kind === 'podium' || kind === 'crown');
  const normItem = (it) => ({ kind: it.kind, index: single(it.kind) ? 0 : (it.index | 0) });
  const keyOf = (it) => `${it.kind}:${it.index}`;
  const sameItem = (a, b) => a.kind === b.kind && a.index === b.index;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function isValid(it) {
    if (!it || !KINDS.includes(it.kind)) return false;
    const s = Store.raw();
    switch (it.kind) {
      case 'segment': return it.index >= 0 && it.index < s.segments.length;
      case 'podium': return !!s.podium.on;
      case 'crown': return !!s.crown && s.crown.type !== 'none';
      case 'carve': return it.index >= 0 && it.index < s.carves.length;
      case 'context': return it.index >= 0 && it.index < (s.context.blocks || []).length;
      default: return false;
    }
  }
  function itemName(it) {
    switch (it.kind) {
      case 'segment': return `Segment ${it.index + 1}`;
      case 'podium': return 'Podium';
      case 'crown': return 'Crown';
      case 'carve': return `Carve ${it.index + 1}`;
      default: return `Context block ${it.index + 1}`;
    }
  }
  function itemSub(it) {
    const s = Store.raw();
    try {
      switch (it.kind) {
        case 'segment': { const g = s.segments[it.index]; return `Segment · ${g.floors} floors · ${progLabel(g.program)}`; }
        case 'podium': return `Podium · ${s.podium.floors} floors`;
        case 'crown': return `Crown · ${({ none: 'none', flat: 'flat parapet', stepped: 'stepped', sloped: 'sloped', spire: 'spire', screen: 'screen' })[s.crown.type] || s.crown.type}`;
        case 'carve': { const c = s.carves[it.index]; return `Carve · ${({ corner: 'corner notch', center: 'center hole', full: 'sky gap' })[c.kind] || c.kind} · floors ${c.startFloor}–${c.endFloor}`; }
        default: { const b = s.context.blocks[it.index]; return `Context block · ${fmt(num(b.h, 0))} high`; }
      }
    } catch (e) { return it.kind; }
  }

  /** The Derived floors that belong to a segment (its mechanical floors included) or to the podium: { z0, z1 }. */
  function zRange(d, it) {
    const list = d.floors.filter((f) => (it.kind === 'podium' ? f.zone === 'podium' : f.zone !== 'podium' && f.segmentIndex === it.index));
    if (!list.length) return null;
    return { z0: Math.min(...list.map((f) => f.z)), z1: Math.max(...list.map((f) => f.z + f.ftf)) };
  }

  /* ==========================================================================
     Footprints (the nominal plan box of a segment, the podium or a context block)
     ========================================================================== */
  function footprint(it) {
    const s = Store.raw(), d = Derived.get();
    if (it.kind === 'context') {
      const b = s.context.blocks[it.index];
      if (!b) return null;
      const w = num(b.w, 0), dd = num(b.d, 0);
      return { box: { minX: num(b.x, 0) - w / 2, maxX: num(b.x, 0) + w / 2, minY: num(b.y, 0) - dd / 2, maxY: num(b.y, 0) + dd / 2 }, resizeX: true, resizeY: true };
    }
    const src = it.kind === 'segment' ? s.segments[it.index] : (it.kind === 'podium' ? s.podium : null);
    if (!src) return null;
    const plateBox = SnapMod.itemBox(s, d.plates, it);
    const shape = src.shape || {};
    const type = String(shape.type || 'rect').toLowerCase();
    const rot = it.kind === 'segment' ? num(src.rotation, 0) : 0;
    const r = ((rot % 360) + 360) % 360;
    const quarter = [0, 90, 180, 270].some((q) => Math.abs(r - q) < 1e-6 || Math.abs(r - 360) < 1e-6);
    const poly = type === 'polygon' || type === 'custom';
    if (poly || !quarter) return plateBox ? { box: plateBox, resizeX: false, resizeY: false } : null;
    const sq = type === 'square' || type === 'circle';
    const w = num(shape.w, 0), dd = num(shape.d, 0);
    const W = sq ? (w > 0 ? w : dd) : w, D = sq ? W : dd;
    if (!(W > 0 && D > 0)) return plateBox ? { box: plateBox, resizeX: false, resizeY: false } : null;
    const swap = !sq && (Math.abs(r - 90) < 1e-6 || Math.abs(r - 270) < 1e-6);
    const ex = swap ? D : W, ey = swap ? W : D;
    const ox = num(src.offset && src.offset.x, 0), oy = num(src.offset && src.offset.y, 0);
    return { box: { minX: ox - ex / 2, maxX: ox + ex / 2, minY: oy - ey / 2, maxY: oy + ey / 2 }, resizeX: true, resizeY: true, sq, swap };
  }
  /** [path, value] writes that set a plan extent along `axis` ('x' | 'y') with the opposite edge fixed (the new center is given). */
  function extentWrites(it, fp, axis, extent, center) {
    if (it.kind === 'context') {
      const base = `context.blocks.${it.index}`;
      return axis === 'x' ? [[`${base}.w`, extent], [`${base}.x`, center]] : [[`${base}.d`, extent], [`${base}.y`, center]];
    }
    const base = it.kind === 'segment' ? `segments.${it.index}` : 'podium';
    const key = fp.sq ? 'w' : (axis === 'x' ? (fp.swap ? 'd' : 'w') : (fp.swap ? 'w' : 'd'));
    return [[`${base}.shape.${key}`, extent], [`${base}.offset.${axis}`, center]];
  }

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
  function meshGeo(s) {
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(s.positions, 3));
    geo.setIndex(s.indices);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    geo.applyMatrix4(planMatrix(0));
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
    const cv = carvesVisible();
    const key = [d.id, s.context.show ? 1 : 0, cv ? 1 : 0].join('|');
    if (pickCache && pickCache.key === key) return pickCache;
    disposePick();
    const meshes = [];
    const groups = new Map();
    for (const p of d.plates) {
      if (p.void || !p.polygons.length) continue;
      const k = p.zone === 'podium' ? 'podium:0' : `segment:${p.segmentIndex}`;
      if (!groups.has(k)) groups.set(k, []);
      try { groups.get(k).push(extrude(p.polygons, p.z, p.ftf)); } catch (e) { /* a degenerate plate is simply not pickable */ }
    }
    for (const [k, geos] of groups) {
      const [kind, idx] = k.split(':');
      mergeInto(meshes, geos, { kind, index: +idx }, 0);
    }
    const crown = [];
    for (const sol of d.solids) {
      try { crown.push(sol.kind === 'mesh' ? meshGeo(sol) : extrude(sol.polygons, sol.z0, sol.z1 - sol.z0)); } catch (e) { /* skip */ }
    }
    mergeInto(meshes, crown, { kind: 'crown', index: 0 }, 0);
    if (s.context.show && s.context.blocks) {
      s.context.blocks.forEach((b, i) => {
        const w = num(b.w, 0), dd = num(b.d, 0), hh = num(b.h, 0);
        if (!(w > 0 && dd > 0 && hh > 0)) return;
        const geo = new THREE.BoxGeometry(w, dd, hh);
        geo.translate(num(b.x, 0), num(b.y, 0), hh / 2);
        geo.applyMatrix4(planMatrix(0));
        mergeInto(meshes, [geo], { kind: 'context', index: i }, 1);
      });
    }
    if (cv) {
      carveVolumes(d, s).forEach((vol, i) => {
        if (!vol) return;
        const geos = [];
        for (const p of vol) { try { geos.push(extrude(p.polygons, p.z, p.ftf)); } catch (e) { /* skip */ } }
        mergeInto(meshes, geos, { kind: 'carve', index: i }, 0);
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
    const s = Store.raw(), d = Derived.get();
    let box = null, z0 = 0, z1 = 0;
    if (it.kind === 'segment' || it.kind === 'podium') {
      box = SnapMod.itemBox(s, d.plates, it);
      const r = zRange(d, it);
      if (r) { z0 = r.z0; z1 = r.z1; }
    } else if (it.kind === 'context') {
      const fp = footprint(it); box = fp && fp.box; z1 = num((s.context.blocks[it.index] || {}).h, 0);
    } else if (it.kind === 'crown') {
      const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      d.solids.forEach((sol) => { z0 = z0 || sol.z0; z1 = Math.max(z1, sol.z1 || 0); (sol.polygons || []).forEach((p) => p.outer.forEach((q) => { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); })); });
      if (isFinite(b.minX)) box = b;
    } else if (it.kind === 'carve') {
      const vol = carveVolumes(d, s)[it.index];
      if (vol && vol.length) {
        const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        vol.forEach((p) => p.polygons[0].outer.forEach((q) => { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }));
        box = b; z0 = vol[0].z; z1 = vol[vol.length - 1].z + vol[vol.length - 1].ftf;
      }
    }
    if (!box) return null;
    const fr = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (const fz of fr) for (const fx of fr) for (const fy of fr) {
      const p = toClient(worldVec(box.minX + (box.maxX - box.minX) * fx, box.minY + (box.maxY - box.minY) * fy, z0 + (z1 - z0) * fz));
      if (p.z < -1 || p.z > 1) continue;
      const hit = pickAt(p.x, p.y);
      if (hit && sameItem(hit, normItem(it))) return { x: p.x, y: p.y };
    }
    return null;
  }

  /* ==========================================================================
     Carve volumes (the void a carve cuts), for the dashed outlines and picking
     ========================================================================== */
  let preCache = null;
  function preCarvePlates(d, s) {
    if (preCache && preCache.geomId === d.geomId) return preCache.plates;
    let plates = [];
    try { plates = Geo.buildPlates({ ...s, carves: [] }).plates; } catch (e) { plates = []; }
    preCache = { geomId: d.geomId, plates };
    return plates;
  }
  function mpCentroid(mp) {
    let A = 0, cx = 0, cy = 0;
    const add = (ring, sign) => {
      const sg = Math.sign(Geo.ringArea(ring)) * sign;
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        const c = (p[0] * q[1] - q[0] * p[1]) * sg;
        A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
      }
    };
    for (const p of mp) { add(p.outer, 1); for (const hole of p.holes || []) add(hole, -1); }
    return Math.abs(A) < 1e-12 ? [0, 0] : [cx / (3 * A), cy / (3 * A)];
  }
  /** One entry per carve: [{ z, ftf, polygons:[{outer: rect}] }] per floor it removes, or null. */
  function carveVolumes(d, s) {
    const out = [];
    const pre = preCarvePlates(d, s);
    const lastN = pre.length ? Math.max(...pre.map((p) => p.n)) : 0;
    (s.carves || []).forEach((c, i) => {
      let a = Math.round(num(c.startFloor, 1)), b = Math.round(num(c.endFloor, a));
      if (b < a) [a, b] = [b, a];
      a = Math.max(1, a); b = Math.min(lastN, b);
      const kind = String(c.kind || 'corner').toLowerCase();
      const corner = String(c.corner || 'NE').toUpperCase();
      const w = Math.max(0, num(c.w, 0)), dd = Math.max(0, num(c.d, 0));
      if (kind !== 'full' && !(w > 0 && dd > 0)) { out[i] = null; return; }
      const list = [];
      for (const p of pre) {
        if (p.n < a || p.n > b || !p.polygons.length) continue;
        const bb = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        for (const poly of p.polygons) for (const q of poly.outer) { bb.minX = Math.min(bb.minX, q[0]); bb.maxX = Math.max(bb.maxX, q[0]); bb.minY = Math.min(bb.minY, q[1]); bb.maxY = Math.max(bb.maxY, q[1]); }
        let x0, x1, y0, y1;
        if (kind === 'full') { x0 = bb.minX; x1 = bb.maxX; y0 = bb.minY; y1 = bb.maxY; }
        else if (kind === 'center') { const [cx, cy] = mpCentroid(p.polygons); x0 = cx - w / 2; x1 = cx + w / 2; y0 = cy - dd / 2; y1 = cy + dd / 2; }
        else {
          if (corner.includes('E')) { x0 = bb.maxX - w; x1 = bb.maxX; } else { x0 = bb.minX; x1 = bb.minX + w; }
          if (corner.includes('N')) { y0 = bb.maxY - dd; y1 = bb.maxY; } else { y0 = bb.minY; y1 = bb.minY + dd; }
        }
        list.push({ z: p.z, ftf: p.ftf, polygons: [{ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }] });
      }
      out[i] = list.length ? list : null;
    });
    return out;
  }
  /** The carve outlines show while a carve is selected or the Carves section is open in the Form tab. */
  function carvesVisible() {
    const s = Store.raw();
    if (!(s.carves || []).length) return false;
    if (items.some((it) => it.kind === 'carve')) return true;
    const sec = document.querySelector('#sections [data-section="carves"]');
    if (!sec || sec.dataset.open !== 'true') return false;
    const panel = sec.closest('.tabpanel');
    return !!panel && !panel.hidden;
  }

  /* ==========================================================================
     Overlay: selection outline, carve outlines, snap guides (3D lines)
     ========================================================================== */
  let outlineGroup = null, carveGroup = null, guideGroup = null;
  let mOutline = null, mHalo = null, mGhost = null, mDash = null, mGuide = null, mSheet = null;
  const cssColorOf = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

  function initOverlay() {
    const root = Render.overlayGroup();
    outlineGroup = new THREE.Group(); carveGroup = new THREE.Group(); guideGroup = new THREE.Group();
    root.add(carveGroup, outlineGroup, guideGroup);
    // Fat lines (a few CSS px wide): a hairline accent outline vanishes on the saturated Diagram colors.
    const fatMat = (o) => new LineMaterial({ color: 0x23508f, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...o });
    mGhost = fatMat({ linewidth: 1.25, opacity: 0.3, depthTest: false });
    mHalo = fatMat({ linewidth: 4.25, opacity: 0.9, depthTest: true });
    mOutline = fatMat({ linewidth: 2, opacity: 1, depthTest: true });
    mDash = new THREE.LineDashedMaterial({ color: 0x23508f, dashSize: 4, gapSize: 3, depthTest: false, transparent: true, opacity: 0.6 });
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
  /** Edge lines of a stack of plates ({ z, ftf, polygons }): loops where a run starts and ends, plus the vertical edges. */
  function outlinePlates(pos, plates) {
    const ps = plates.filter((p) => p.polygons && p.polygons.length).sort((a, b) => a.z - b.z);
    if (!ps.length) return;
    const seg = (a, b) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
    const W = (q, z) => planToWorld(q[0], q[1], z);
    const loop = (ring, z) => { for (let i = 0; i < ring.length; i++) seg(W(ring[i], z), W(ring[(i + 1) % ring.length], z)); };
    const rings = (p) => p.polygons.flatMap((poly) => [poly.outer, ...(poly.holes || [])]);
    const sig = (p) => p.polygons.map((poly) => `${poly.outer.length}:${(poly.holes || []).map((x) => x.length).join(',')}`).join('|');
    const joined = (a, b) => {
      if (sig(a) !== sig(b)) return false;
      for (let i = 0; i < a.polygons.length; i++) {
        const ra = a.polygons[i].outer, rb = b.polygons[i].outer;
        for (let j = 0; j < ra.length; j++) if (Math.hypot(ra[j][0] - rb[j][0], ra[j][1] - rb[j][1]) > 3) return false;
      }
      return true;
    };
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k], prev = ps[k - 1], next = ps[k + 1];
      const joinedPrev = !!prev && joined(prev, p), joinedNext = !!next && joined(p, next);
      if (!joinedPrev) rings(p).forEach((r) => loop(r, p.z));
      if (!joinedNext) rings(p).forEach((r) => loop(r, p.z + p.ftf));
      p.polygons.forEach((poly, pi) => {
        const ring = poly.outer, step = Math.max(1, Math.ceil(ring.length / 16));
        for (let j = 0; j < ring.length; j += step) {
          seg(W(ring[j], p.z), W(ring[j], p.z + p.ftf));
          if (joinedNext) seg(W(ring[j], p.z + p.ftf), W(next.polygons[pi].outer[j], next.z));
        }
      });
    }
  }
  function pushOutline(pos, it, d, s) {
    if (it.kind === 'segment' || it.kind === 'podium') {
      outlinePlates(pos, d.plates.filter((p) => !p.void && (it.kind === 'podium' ? p.zone === 'podium' : p.zone !== 'podium' && p.segmentIndex === it.index)));
    } else if (it.kind === 'crown') {
      for (const sol of d.solids) { try { pushEdges(pos, sol.kind === 'mesh' ? meshGeo(sol) : extrude(sol.polygons, sol.z0, sol.z1 - sol.z0)); } catch (e) { /* skip */ } }
    } else if (it.kind === 'context') {
      const b = s.context.blocks[it.index];
      if (!b) return;
      const geo = new THREE.BoxGeometry(num(b.w, 0), num(b.d, 0), num(b.h, 0));
      geo.translate(num(b.x, 0), num(b.y, 0), num(b.h, 0) / 2);
      geo.applyMatrix4(planMatrix(0));
      pushEdges(pos, geo);
    } else if (it.kind === 'carve') {
      const vol = carveVolumes(d, s)[it.index];
      if (vol) outlinePlates(pos, vol);
    }
  }
  function refreshOverlay() {
    if (!ready || !outlineGroup) return;
    clearGroup(outlineGroup); clearGroup(carveGroup);
    if (Render.comparing()) { Render.requestRender(); return; }
    const accent = cssColorOf('--accent', '#23508f');
    mOutline.color.copy(accent); mGhost.color.copy(accent); mDash.color.copy(accent);
    mHalo.color.copy(cssColorOf('--surface', '#ffffff'));
    const d = Derived.get(), s = Store.raw();
    const pos = [];
    for (const it of items) pushOutline(pos, it, d, s);
    fat(outlineGroup, pos, mGhost, 11);
    fat(outlineGroup, pos, mHalo, 12);
    fat(outlineGroup, pos, mOutline, 13);
    if (carvesVisible()) {
      const vols = carveVolumes(d, s);
      const dpos = [];
      vols.forEach((vol, i) => { if (vol && !items.some((it) => it.kind === 'carve' && it.index === i)) outlinePlates(dpos, vol); });
      lines(carveGroup, dpos, mDash, 9, true);
    }
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
    ['width', 'resize', 'Change the width'],
    ['depth', 'resize', 'Change the depth'],
    ['top', 'top', 'Change the height'],
  ];
  const GLYPH = {
    move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>',
    resize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M7 12h13M16 8l4 4-4 4"/></svg>',
    top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12M12 20V9M7 13l5-5 5 5"/></svg>',
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
    if (!(it.kind === 'segment' || it.kind === 'podium' || it.kind === 'context')) return null;
    const s = Store.raw(), d = Derived.get();
    const fp = footprint(it);
    if (!fp) return null;
    let z0 = 0, z1 = 0;
    if (it.kind === 'context') z1 = num((s.context.blocks[it.index] || {}).h, 0);
    else { const r = zRange(d, it); if (!r) return null; z0 = r.z0; z1 = r.z1; }
    const b = fp.box, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const hs = [
      { id: 'move-x', kind: 'move', anchor: worldVec(cx, b.minY, z0), axis: AX, out: AY.clone().negate() },
      { id: 'move-y', kind: 'move', anchor: worldVec(b.minX, cy, z0), axis: AY, out: AX.clone().negate() },
    ];
    if (fp.resizeX) hs.push({ id: 'width', kind: 'resize', anchor: worldVec(b.maxX, cy, z1), axis: AX, out: AX });
    if (fp.resizeY) hs.push({ id: 'depth', kind: 'resize', anchor: worldVec(cx, b.maxY, z1), axis: AY, out: AY });
    hs.push({ id: 'top', kind: 'top', anchor: worldVec(cx, cy, z1), axis: AZ, out: null });
    return { item: it, fp, z0, z1, hs };
  }
  function handlesWanted() {
    return ready && items.length === 1 && ['segment', 'podium', 'context'].includes(items[0].kind) && !Render.comparing();
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
      const p = px(hd.anchor);
      if (p.z < -1 || p.z > 1) hide = true;
      if (hide) { el.hidden = true; continue; }
      let ox = 0, oy = 0;
      if (hd.kind === 'top') { if (elevation) oy = -(coarse ? 30 : 24); }
      else if (hd.kind === 'move' && elevation) oy = coarse ? 32 : 26;
      else if (hd.out) {
        const q = px(hd.anchor.clone().addScaledVector(hd.out, 1));
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
        const off = (hd.kind === 'move' ? 26 : 18) + (coarse ? 6 : 0);
        if (len > 0.02) { ox = (dx / len) * off; oy = (dy / len) * off; } else oy = off;
      }
      let ang = 0;
      if (hd.kind !== 'top') {
        const q = px(hd.anchor.clone().addScaledVector(hd.axis, 10));
        ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      }
      el.hidden = false;
      el.style.transform = `translate(${(p.x + ox).toFixed(1)}px, ${(p.y + oy).toFixed(1)}px)`;
      el.firstChild.firstChild.style.transform = hd.kind === 'top' ? '' : `rotate(${ang.toFixed(1)}deg)`;
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
  function startDrag(id, cx, cy, opt = {}) {
    if (!ready) return false;
    if (drag) endDrag(true);
    if (!handlesWanted()) return false;
    const it = items[0];
    const info = handleInfo(it);
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return false;
    const f = viewDirAt(hd.anchor);
    const n = f.clone().addScaledVector(hd.axis, -f.dot(hd.axis));
    if (n.lengthSq() < 1e-8) return false;
    n.normalize();
    const s = Store.raw(), d = Derived.get();
    const snapBox = SnapMod.itemBox(s, d.plates, it) || info.fp.box;
    const touch = !!opt.touch;
    drag = {
      id, item: it, info, fp: info.fp, snapBox, p0: hd.anchor.clone(), axis: hd.axis.clone(), n, t0: 0,
      pointerId: opt.pointerId, touch, orig: {}, pending: null, raf: 0,
      targets: SnapMod.collectSnapTargets(s, d.plates, { exclude: it }),
      tol: clamp(ftPerPx(worldVec((info.fp.box.minX + info.fp.box.maxX) / 2, (info.fp.box.minY + info.fp.box.maxY) / 2, 0)) * (touch ? TOL_PX_TOUCH : TOL_PX), 0.5, 20),
      base: clone(it.kind === 'segment' ? s.segments[it.index] : it.kind === 'podium' ? s.podium : s.context.blocks[it.index]),
    };
    const t0 = pointerParam(cx, cy);
    if (t0 == null) { drag = null; return false; }
    drag.t0 = t0;
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
  function dragMove(cx, cy, alt) {
    if (!drag) return null;
    const t0 = pointerParam(cx, cy);
    if (t0 == null) return lastDrag;
    const t = t0 - drag.t0;
    const sn = snapSettings();
    const enabled = sn.on && !alt;
    const it = drag.item, fp = drag.fp, id = drag.id;
    const centerName = it.kind === 'context' ? 'Center' : 'Offset';
    const base = drag.base;
    let label = '', guides = [];
    const posPath = (axis) => (it.kind === 'context' ? `context.blocks.${it.index}.${axis}` : `${it.kind === 'segment' ? `segments.${it.index}` : 'podium'}.offset.${axis}`);
    const posBase = (axis) => (it.kind === 'context' ? num(base[axis], 0) : num(base.offset && base.offset[axis], 0));

    if (id === 'move-x' || id === 'move-y') {
      const ax = id === 'move-x' ? 'x' : 'y';
      const res = SnapMod.snapMove(drag.snapBox, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, { tolerance: drag.tol, grid: sn.grid, enabled });
      let delta = ax === 'x' ? res.dx : res.dy;
      if (!enabled) delta = rnd(t, 10);
      guides = res.guides.filter((g) => g.axis === ax && g.kind !== 'grid');
      const v = rnd(posBase(ax) + delta, 10000);
      write(posPath(ax), v);
      label = `${centerName} ${ax} ${fmt(v)}`;
    } else if (id === 'width' || id === 'depth') {
      const ax = id === 'width' ? 'x' : 'y';
      const lo = ax === 'x' ? fp.box.minX : fp.box.minY, hi = ax === 'x' ? fp.box.maxX : fp.box.maxY;
      const span = ax === 'x' ? { from: fp.box.minY, to: fp.box.maxY } : { from: fp.box.minX, to: fp.box.maxX };
      const r = SnapMod.snapEdge(hi + t, ax, drag.targets, { tolerance: drag.tol, grid: 0, enabled, span });
      let ext = r.value - lo;
      if (!r.guide) ext = SnapMod.snapLength(ext, { step: enabled ? 1 : 0.1 });
      ext = clamp(ext, 1, MAXD);
      if (r.guide && r.guide.kind !== 'grid') guides = [r.guide];
      const center = lo + ext / 2;
      for (const [path, v] of extentWrites(it, fp, ax, rnd(ext, 10000), rnd(center, 10000))) write(path, v);
      label = `${id === 'width' ? 'Width' : 'Depth'} ${fmt(ext)}`;
    } else if (id === 'top') {
      if (it.kind === 'context') {
        const h0 = num(base.h, 0);
        const hh = clamp(SnapMod.snapLength(h0 + t, { step: enabled ? 1 : 0.1 }), 1, MAXD);
        write(`context.blocks.${it.index}.h`, hh);
        label = `Height ${fmt(hh)}`;
      } else {
        const ftf = Math.max(1, num(base.ftf, 10));
        const n0 = Math.round(num(base.floors, 1));
        const n = clamp(Math.max(1, n0 + Math.round(t / ftf)), 1, CONFIG.limits.maxFloors);
        write(it.kind === 'segment' ? `segments.${it.index}.floors` : 'podium.floors', n);
        const hgt = it.kind === 'podium' ? num(base.groundFtf, ftf) + (n - 1) * ftf : n * ftf;
        label = `${n} ${n === 1 ? 'floor' : 'floors'} · ${fmt(hgt)}`;
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
   *  simulateHandleDrag('move-x', dx) · ('move-y', 0, dy) · ('width', dx) · ('depth', 0, dy) · ('top', 0, dz); opts { alt, hold }.
   *  With hold the drag stays open (guides and label stay on screen) until releaseHandleDrag(). */
  function simulateHandleDrag(id, a = 0, b = 0, opts = {}) {
    if (!ready) return null;
    if (drag) endDrag(true);
    const info = items.length === 1 ? handleInfo(items[0]) : null;
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return null;
    const amount = (id === 'move-x' || id === 'width') ? a : (b !== 0 ? b : a);
    const target = hd.anchor.clone().addScaledVector(hd.axis, amount);
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
  /** Drops items that no longer exist (undo, delete, podium turned off). */
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
    let segIdx = [...new Set(sel.filter((i) => i.kind === 'segment').map((i) => i.index))].sort((a, b) => a - b);
    if (segIdx.length && segIdx.length >= next.segments.length) {
      segIdx = segIdx.slice(1);                  // never delete the last segment: the lowest one stays
      Toast.show('A tower needs at least one segment, so one was kept.', 'warn');
    }
    for (const i of segIdx.slice().reverse()) { next.segments.splice(i, 1); removed++; }
    for (const i of [...new Set(sel.filter((x) => x.kind === 'carve').map((x) => x.index))].sort((a, b) => b - a)) { next.carves.splice(i, 1); removed++; }
    for (const i of [...new Set(sel.filter((x) => x.kind === 'context').map((x) => x.index))].sort((a, b) => b - a)) { next.context.blocks.splice(i, 1); removed++; }
    if (sel.some((x) => x.kind === 'podium') && next.podium.on) { next.podium.on = false; removed++; }
    if (sel.some((x) => x.kind === 'crown') && next.crown.type !== 'none') { next.crown.type = 'none'; removed++; }
    if (!removed) return 0;
    Store.replace(next);
    setItems([]);
    return removed;
  }
  function deleteSelection() { return deleteItems(items); }

  function copySegment(index, where = 'above') {
    const s = Store.raw();
    if (!s.segments[index]) return false;
    const next = clone(s);
    const at = where === 'below' ? index : index + 1;
    next.segments.splice(at, 0, clone(next.segments[index]));
    Store.replace(next);
    setItems([{ kind: 'segment', index: at }]);
    return at;
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
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) { setItems([hit]); UI.openItem(hit); }
    });
  }
  function click(cx, cy, shift) {
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
  const bsp = (path) => Controls.bindStore(Store, path);
  const lenF = (label, path, extra = {}) => Controls.slider({
    label, bind: bsp(path), min: 0, max: 1, step: 1, hardMin: 1, hardMax: MAXD, format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', compact: true, ...extra,
  });
  const offF = (label, path) => lenF(label, path, { hardMin: -MAXD });
  const intF = (label, path, extra = {}) => Controls.slider({
    label, bind: bsp(path), min: 0, max: 1, step: 1, hardMin: 1, hardMax: CONFIG.limits.maxFloors, integer: true, format: Units.formatInt, inputMode: 'numeric', compact: true, ...extra,
  });
  const degF = (label, path) => Controls.slider({
    label, bind: bsp(path), min: 0, max: 1, step: 1, hardMin: -3600, hardMax: 3600, format: (v) => `${Math.round(v * 10) / 10}°`, inputMode: 'decimal', compact: true,
  });
  const selF = (label, path, options) => Controls.select({ label, bind: bsp(path), options: options.map(([value, text]) => ({ value, label: text })) });
  const shapeTypeOf = (prefix) => () => String(Store.get(`${prefix}.type`) || 'rect').toLowerCase();

  function fieldsFor(it) {
    const els = (list) => list.map((c) => c.el || c);
    if (it.kind === 'segment' || it.kind === 'podium') {
      const p = it.kind === 'segment' ? `segments.${it.index}` : 'podium';
      const ty = shapeTypeOf(`${p}.shape`);
      const f = [intF('Floors', `${p}.floors`)];
      if (it.kind === 'podium') f.push(lenF('Ground FTF', `${p}.groundFtf`, { step: 0.5, hardMin: 6 }), lenF('FTF', `${p}.ftf`, { step: 0.5, hardMin: 6 }));
      else f.push(lenF('FTF', `${p}.ftf`, { step: 0.5, hardMin: 6 }));
      f.push(
        Controls.when(() => ['rect', 'ellipse', 'triangle', 'l', 'u'].includes(ty()), [lenF('Width', `${p}.shape.w`), lenF('Depth', `${p}.shape.d`)]),
        Controls.when(() => ty() === 'square', [lenF('Side', `${p}.shape.w`)]),
        Controls.when(() => ty() === 'circle', [lenF('Diameter', `${p}.shape.w`)]),
        offF('Offset x', `${p}.offset.x`), offF('Offset y', `${p}.offset.y`),
      );
      if (it.kind === 'segment') f.push(degF('Rotate', `${p}.rotation`));
      return els(f);
    }
    if (it.kind === 'crown') {
      const type = () => Store.get('crown.type');
      return els([
        selF('Type', 'crown.type', [['none', 'None'], ['flat', 'Flat (parapet)'], ['stepped', 'Stepped'], ['sloped', 'Sloped'], ['spire', 'Spire'], ['screen', 'Screen']]),
        Controls.when(() => !['flat', 'none'].includes(type()), [lenF('Height', 'crown.height', { hardMin: 0 })]),
      ]);
    }
    if (it.kind === 'carve') {
      const p = `carves.${it.index}`, kind = () => Store.get(`${p}.kind`);
      return els([
        selF('Kind', `${p}.kind`, [['corner', 'Corner notch'], ['center', 'Center hole'], ['full', 'Sky gap']]),
        Controls.when(() => kind() === 'corner', [selF('Corner', `${p}.corner`, [['NE', 'North-east'], ['NW', 'North-west'], ['SE', 'South-east'], ['SW', 'South-west']])]),
        intF('From floor', `${p}.startFloor`), intF('To floor', `${p}.endFloor`),
        Controls.when(() => kind() !== 'full', [lenF('Width', `${p}.w`), lenF('Depth', `${p}.d`)]),
      ]);
    }
    const p = `context.blocks.${it.index}`;
    return els([offF('Center x', `${p}.x`), offF('Center y', `${p}.y`), lenF('Width', `${p}.w`), lenF('Depth', `${p}.d`), lenF('Height', `${p}.h`)]);
  }

  const PROGRAM_KEYS = () => Object.keys(CONFIG.programs).filter((k) => k !== 'mechanical');
  function programItems(part) {
    return items.filter((i) => i.kind === 'segment' || i.kind === 'podium').map((i) => (i.kind === 'podium' && part ? { kind: 'podium', part } : i));
  }
  function programOf(i, part) {
    const s = Store.raw();
    if (i.kind === 'segment') return (s.segments[i.index] || {}).program;
    return part === 'upper' ? s.podium.upperProgram : s.podium.program;
  }
  function programRow(label, part) {
    const row = h('div', { class: 'sc-prog', role: 'group', 'aria-label': label || 'Program' });
    const btns = PROGRAM_KEYS().map((k) => {
      const dot = h('span', { class: 'sc-dot', 'aria-hidden': 'true' });
      const b = h('button', { class: 'sc-pbtn', type: 'button', 'data-program': k, 'aria-pressed': 'false', title: progLabel(k), onclick: () => { UI.setProgramForItems(programItems(part), k); } }, dot, progLabel(k));
      row.append(b);
      return { b, dot, k };
    });
    const refresh = () => {
      const list = programItems(part);
      const vals = list.map((i) => programOf(i, part));
      const common = vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
      btns.forEach(({ b, dot, k }) => { b.setAttribute('aria-pressed', String(common === k)); dot.style.background = progColor(k); });
    };
    return { el: h('div', { class: 'sc-prog-wrap' }, label ? h('div', { class: 'sc-sub' }, label) : null, row), refresh };
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

      const hasProgram = items.some((i) => i.kind === 'segment' || i.kind === 'podium');
      const rows = [];
      if (hasProgram) {
        if (one && one.kind === 'podium') rows.push(programRow('Ground floor', 'ground'), programRow('Upper floors', 'upper'));
        else rows.push(programRow(null, null));
        rows.forEach((r) => { card.append(r.el); extra.push(r.refresh); });
      }
      const actions = h('div', { class: 'sc-actions' });
      if (one && one.kind === 'segment') {
        actions.append(
          h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'copy-above', onclick: () => copySegment(one.index, 'above') }, 'Copy above'),
          h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'copy-below', onclick: () => copySegment(one.index, 'below') }, 'Copy below'),
        );
      }
      if (one) actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'open', onclick: () => UI.openItem(one) }, 'Open in panel'));
      actions.append(h('button', { class: 'btn outline sm danger-text', type: 'button', 'data-action': 'delete', onclick: () => deleteSelection() }, 'Delete'));
      card.append(actions);
      if (one) {
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
  function syncRows() {
    const map = { segments: 'segment', carves: 'carve', context: 'context' };
    for (const [sec, kind] of Object.entries(map)) {
      document.querySelectorAll(`#sections [data-section="${sec}"] .item[data-index]`).forEach((row) => {
        row.classList.toggle('sel-row', items.some((i) => i.kind === kind && i.index === +row.dataset.index));
      });
    }
  }
  function initPanelLink() {
    $('sections').addEventListener('click', (e) => {
      const head = e.target.closest && e.target.closest('.item-title');
      if (!head) return;
      const row = head.closest('.item[data-index]'), sec = head.closest('[data-section]');
      if (!row || !sec) return;
      const kind = { segments: 'segment', carves: 'carve', context: 'context' }[sec.dataset.section];
      if (!kind) return;
      const it = { kind, index: +row.dataset.index };
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
    if (cmd && !e.altKey && !e.shiftKey && key.toLowerCase() === 'd') {
      e.preventDefault();
      if (items.length === 1 && items[0].kind === 'segment') copySegment(items[0].index, 'above');
      else Toast.show('Select one segment to copy it.', '', 2200);
      return;
    }
    if (cmd || e.altKey) return;
    if (key === 'Escape') { if (drag) { endDrag(false); e.preventDefault(); } else if (items.length) { clear(); e.preventDefault(); } return; }
    if (key === 'Delete' || key === 'Backspace') { if (items.length) { e.preventDefault(); deleteSelection(); } return; }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'diagram' ? 'model' : 'diagram', { live: false }); }
  }

  /* ==========================================================================
     Init
     ========================================================================== */
  let overlayTimer = 0;
  function scheduleOverlay() {
    if (overlayTimer) return;
    overlayTimer = requestAnimationFrame(() => { overlayTimer = 0; refreshOverlay(); });
  }
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
    Render.onRebuild(() => { if (items.length || carvesVisible()) scheduleOverlay(); });
    // The carve outlines follow the Carves section: open / closed and the tab it sits in.
    try { new MutationObserver(() => scheduleOverlay()).observe($('sections'), { subtree: true, attributes: true, attributeFilter: ['data-open', 'hidden'] }); } catch (e) { /* no observer: the outlines update on the next change */ }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener('change', scheduleOverlay) : mq.addListener(scheduleOverlay));
    window.addEventListener('resize', () => Render.requestRender());
  }

  return {
    init,
    select: (list) => setItems(list), add: (it) => setItems([...items, it]), toggle: toggleItem, clear,
    get: () => items.map((i) => ({ ...i })), count: () => items.length,
    deleteSelection, deleteItems, copySegment,
    pickAt, click, screenPointFor, visibleHandles, simulateHandleDrag,
    releaseHandleDrag: () => { flushMove(); endDrag(true); },
    cancelHandleDrag: () => endDrag(false),
    dragging: () => !!drag, lastDrag: () => lastDrag,
    handlesShown: () => handlesWanted(),     // read-only: a selection with visible handles (the placement gizmo yields to it)
    setAddMode: (v) => { addMode = !!v; if (cardRefs && cardRefs.more) cardRefs.more.setAttribute('aria-pressed', String(addMode)); },
    addMode: () => addMode,
    onChange: (fn) => listeners.push(fn),
    carvesVisible, refreshOverlay,
    overlayInfo: () => ({ outline: outlineGroup ? outlineGroup.children.length : 0, carve: carveGroup ? carveGroup.children.length : 0, guides: guideGroup ? guideGroup.children.length : 0 }),
    footprint,
  };
})();
