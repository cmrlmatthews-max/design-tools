/* ==========================================================================
   TOWER: selection, handles, snapping, copy and delete
   Port of build/tower/06b_select.js for the app shell.
   - Items are { kind: 'segment' | 'podium' | 'crown' | 'carve' | 'context', index } (podium and crown: index 0).
   - Selection lives here, never in the store (it is not saved or undone). The shell shows the card: ctx.select(item, 'tower').
   - Five handles (move-x, move-y, width, depth, top) are DOM grips in #handles. A drag is a run of live store sets that
     commit as ONE undo step. Snapping uses src/tower/snap.js (grid, site, setbacks, other pieces).
   - The selection outline, the carve outlines and the snap guides are 3D lines in the overlay root (hidden in pictures).
   All geometry here is in the tower LOCAL frame; the overlay group is placed with ctx.frame.placeGroup, and screen
   positions go through the placement (local -> project -> scene).
   ========================================================================== */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { toProject } from '../../../src/shared/project.js';
import * as Snap from '../../../src/tower/snap.js';
import { CONFIG, Geo, num, clamp, deepClone, effectiveState } from './state.js';
import { extrudePolys, solidGeometry } from './render.js';
import { planToWorld } from '../../core/frame.js';
import { Units } from '../../core/ui-kit.js';

const MAXD = CONFIG.limits.maxDim;
const HIDE_DOT = 0.95;
const GUIDE_COLOR = '#f28a1a';
const TOL_PX = 12, TOL_PX_TOUCH = 16;
const KINDS = ['segment', 'podium', 'crown', 'carve', 'context'];
const rnd = (v, k = 1000) => Math.round(v * k) / k;
const GLYPH = {
  move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>',
  resize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M7 12h13M16 8l4 4-4 4"/></svg>',
  top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12M12 20V9M7 13l5-5 5 5"/></svg>',
};
const HANDLE_DEFS = [
  ['move-x', 'move', 'Move east or west'],
  ['move-y', 'move', 'Move north or south'],
  ['width', 'resize', 'Change the width'],
  ['depth', 'resize', 'Change the depth'],
  ['top', 'top', 'Change the height'],
];

export function createSelect(T) {
  const { ctx, store } = T;
  const { h } = ctx.ui;
  const fmt = (v) => Units.formatFeetInches(v);
  const progLabel = (k) => (CONFIG.programs[k] || {}).label || k;
  const isCoarse = () => { try { return !!ctx.input.isCoarse(); } catch (e) { return false; } };

  let items = [];
  let addMode = false;
  let drag = null;
  let lastDrag = null;
  let suppress = false;                       // true while this module calls ctx.select itself
  const listeners = [];

  /* ---- local frame to the scene ---- */
  const plc = () => T.project.placement();
  function lw(x, y, z = 0) {
    const p = toProject(plc(), [x, y, z]);
    const s = ctx.frame.toScene(p);
    return ctx.frame.worldVec(s[0], s[1], s[2]);
  }
  /** World direction of a local unit step (feet stay feet: placement only turns and moves). */
  function dirW(dx, dy, dz) {
    const a = lw(0, 0, 0), b = lw(dx, dy, dz);
    return b.sub(a).normalize();
  }

  /* ---- items ---- */
  const single = (kind) => (kind === 'podium' || kind === 'crown');
  const normItem = (it) => ({ kind: it.kind, index: single(it.kind) ? 0 : (it.index | 0) });
  const sameItem = (a, b) => a.kind === b.kind && a.index === b.index;

  function isValid(it) {
    if (!it || !KINDS.includes(it.kind)) return false;
    const s = store.raw();
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
  /** The Derived floors that belong to a segment (its mechanical floors included) or to the podium: { z0, z1 }. */
  function zRange(d, it) {
    const list = d.floors.filter((f) => (it.kind === 'podium' ? f.zone === 'podium' : f.zone !== 'podium' && f.segmentIndex === it.index));
    if (!list.length) return null;
    return { z0: Math.min(...list.map((f) => f.z)), z1: Math.max(...list.map((f) => f.z + f.ftf)) };
  }

  /** The card item for the shell: title, rows and the kind/index this module uses. */
  function cardItem(it) {
    const s = store.raw(), d = T.derived.get();
    const rows = [];
    const owner = CONFIG.tool;
    const base = { id: `tower:${it.kind}:${it.index}`, kind: it.kind, index: it.index, title: itemName(it), owner, tool: owner };
    try {
      if (it.kind === 'segment') {
        const g = s.segments[it.index];
        const r = zRange(d, it);
        const area = d.plates.filter((p) => !p.void && p.zone !== 'podium' && p.segmentIndex === it.index).reduce((a, p) => a + p.area, 0);
        rows.push(['Program', progLabel(g.program)], ['Floors', String(g.floors)], ['Floor-to-floor', fmt(g.ftf)]);
        if (r) rows.push(['Elevation', `${fmt(r.z0)} to ${fmt(r.z1)}`]);
        rows.push(['Gross area', `${Math.round(area).toLocaleString('en-US')} sf`]);
      } else if (it.kind === 'podium') {
        const r = zRange(d, it);
        const area = d.plates.filter((p) => !p.void && p.zone === 'podium').reduce((a, p) => a + p.area, 0);
        rows.push(['Floors', String(s.podium.floors)], ['Ground floor', progLabel(s.podium.program)], ['Upper floors', progLabel(s.podium.upperProgram)]);
        if (r) rows.push(['Height', fmt(r.z1 - r.z0)]);
        rows.push(['Gross area', `${Math.round(area).toLocaleString('en-US')} sf`]);
      } else if (it.kind === 'crown') {
        rows.push(['Type', s.crown.type], ['Height', fmt(num(s.crown.height, 0))]);
      } else if (it.kind === 'carve') {
        const c = s.carves[it.index];
        rows.push(['Kind', ({ corner: 'Corner notch', center: 'Center hole', full: 'Sky gap' })[c.kind] || c.kind], ['Floors', `${c.startFloor} to ${c.endFloor}`]);
      } else {
        const b = s.context.blocks[it.index];
        rows.push(['Height', fmt(num(b.h, 0))], ['Size', `${fmt(num(b.w, 0))} x ${fmt(num(b.d, 0))}`], ['Source', b.site ? 'Site' : 'Manual']);
      }
    } catch (e) { /* a card with a title only */ }
    return { ...base, rows };
  }

  /* ---- footprints ---- */
  function footprint(it) {
    const s = store.raw(), d = T.derived.get();
    if (it.kind === 'context') {
      const b = s.context.blocks[it.index];
      if (!b) return null;
      const w = num(b.w, 0), dd = num(b.d, 0);
      return { box: { minX: num(b.x, 0) - w / 2, maxX: num(b.x, 0) + w / 2, minY: num(b.y, 0) - dd / 2, maxY: num(b.y, 0) + dd / 2 }, resizeX: true, resizeY: true };
    }
    const src = it.kind === 'segment' ? s.segments[it.index] : (it.kind === 'podium' ? s.podium : null);
    if (!src) return null;
    const plateBox = Snap.itemBox(s, d.plates, it);
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
  function extentWrites(it, fp, axis, extent, center) {
    if (it.kind === 'context') {
      const base = `context.blocks.${it.index}`;
      return axis === 'x' ? [[`${base}.w`, extent], [`${base}.x`, center]] : [[`${base}.d`, extent], [`${base}.y`, center]];
    }
    const base = it.kind === 'segment' ? `segments.${it.index}` : 'podium';
    const key = fp.sq ? 'w' : (axis === 'x' ? (fp.swap ? 'd' : 'w') : (fp.swap ? 'w' : 'd'));
    return [[`${base}.shape.${key}`, extent], [`${base}.offset.${axis}`, center]];
  }

  /* ---- carve volumes (the void a carve cuts) ---- */
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
  function carvesVisible() {
    const s = store.raw();
    if (!(s.carves || []).length) return false;
    return items.some((it) => it.kind === 'carve') || !!T.flags.carvesOpen;
  }

  /* ---- overlay: outline, carve outlines, guides ---- */
  const root = new THREE.Group();
  root.name = 'tower-select';
  const outlineGroup = new THREE.Group(), carveGroup = new THREE.Group(), guideGroup = new THREE.Group(), pickGroup = new THREE.Group();
  root.add(carveGroup, outlineGroup, guideGroup, pickGroup);
  let overlayOn = false;
  const fatMat = (o) => new LineMaterial({ color: 0x6aa2ea, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...o });
  const mGhost = fatMat({ linewidth: 1.25, opacity: 0.3, depthTest: false });
  const mHalo = fatMat({ linewidth: 4.25, opacity: 0.9, depthTest: true, color: 0x10161c });
  const mOutline = fatMat({ linewidth: 2, opacity: 1, depthTest: true });
  const mDash = new THREE.LineDashedMaterial({ color: 0x6aa2ea, dashSize: 4, gapSize: 3, depthTest: false, transparent: true, opacity: 0.7 });
  const mGuide = new THREE.LineDashedMaterial({ color: GUIDE_COLOR, dashSize: 6, gapSize: 4, depthTest: false, transparent: true });
  const mSheet = new THREE.MeshBasicMaterial({ color: GUIDE_COLOR, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const pickMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

  function clearGroup(g) { for (const o of [...g.children]) { g.remove(o); if (o.geometry) o.geometry.dispose(); } }
  function lines(group, pos, material, order, dashed) {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(geo, material);
    ls.renderOrder = order; ls.frustumCulled = false;
    if (dashed) ls.computeLineDistances();
    group.add(ls);
  }
  function fat(group, pos, material, order) {
    if (!pos.length) return;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const ls = new LineSegments2(geo, material);
    ls.renderOrder = order; ls.frustumCulled = false;
    group.add(ls);
  }
  function pushEdges(pos, geo) {
    const e = new THREE.EdgesGeometry(geo, 20);
    const a = e.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
    e.dispose(); geo.dispose();
  }
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
      for (const sol of d.solids) { try { pushEdges(pos, solidGeometry(sol)); } catch (e) { /* skip */ } }
    } else if (it.kind === 'context') {
      const b = s.context.blocks[it.index];
      if (!b) return;
      const base = Number.isFinite(b.base) ? b.base : 0;
      const geo = new THREE.BoxGeometry(num(b.w, 0), num(b.d, 0), num(b.h, 0));
      geo.translate(num(b.x, 0), num(b.y, 0), base + num(b.h, 0) / 2);
      geo.applyMatrix4(ctx.frame.planMatrix(0));
      pushEdges(pos, geo);
    } else if (it.kind === 'carve') {
      const vol = carveVolumes(d, s)[it.index];
      if (vol) outlinePlates(pos, vol);
    }
  }
  function rebuildPickProxies() {
    clearGroup(pickGroup);
    if (!carvesVisible()) return;
    const d = T.derived.get(), s = store.raw();
    carveVolumes(d, s).forEach((vol, i) => {
      if (!vol) return;
      const geos = [];
      for (const p of vol) { try { geos.push(extrudePolys(p.polygons, p.z, p.ftf)); } catch (e) { /* skip */ } }
      if (!geos.length) return;
      const merged = geos.length === 1 ? geos[0] : mergeGeos(geos);
      if (!merged) return;
      const m = new THREE.Mesh(merged, pickMat);
      m.userData.item = { kind: 'carve', index: i };
      pickGroup.add(m);
    });
  }
  function mergeGeos(geos) {
    const pos = [];
    for (const g of geos) { const a = g.getAttribute('position'); for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i)); g.dispose(); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return out;
  }

  function placeRoot() {
    ctx.frame.placeGroup(root, plc());
    root.updateMatrixWorld(true);
  }
  function setResolution() {
    const c = ctx.scene.canvas && ctx.scene.canvas();
    if (!c) return;
    const r = c.getBoundingClientRect();
    for (const m of [mOutline, mHalo, mGhost]) m.resolution.set(Math.max(1, r.width), Math.max(1, r.height));
  }
  function refreshOverlay() {
    if (!overlayOn) return;
    clearGroup(outlineGroup); clearGroup(carveGroup);
    placeRoot(); setResolution();
    const d = T.derived.get(), s = store.raw();
    const pos = [];
    for (const it of items) pushOutline(pos, it, d, s);
    fat(outlineGroup, pos, mGhost, 11);
    fat(outlineGroup, pos, mHalo, 12);
    fat(outlineGroup, pos, mOutline, 13);
    if (carvesVisible()) {
      const dpos = [];
      carveVolumes(d, s).forEach((vol, i) => { if (vol && !items.some((it) => it.kind === 'carve' && it.index === i)) outlinePlates(dpos, vol); });
      lines(carveGroup, dpos, mDash, 9, true);
    }
    rebuildPickProxies();
    ctx.scene.requestRender();
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
    placeRoot();
    ctx.scene.requestRender();
  }

  /* ---- picking ---- */
  function modelTargets() {
    const out = [];
    // Hidden October 28, 2026 (Cade). See docs/removed-features.md. The context layer has no pickable meshes (it builds nothing), so only the model is picked.
    for (const id of ['tower-model']) {
      const o = ctx.layers.get(id);
      if (!o || !o.visible) continue;
      o.updateWorldMatrix(true, true);
      o.traverse((m) => { if (m.isMesh && m.userData.pick && m.visible !== false) out.push(m); });
    }
    return out;
  }
  /** The item under a screen point (client px), or null. Model items win over context blocks (the blocks are see-through). */
  function pickAt(cx, cy) {
    let ray = null;
    try { ray = ctx.scene.rayFrom(cx, cy); } catch (e) { return null; }
    if (!ray) return null;
    const targets = modelTargets();
    root.updateWorldMatrix(true, true);
    const proxies = pickGroup.children.slice();
    const hits = ray.intersectObjects([...targets, ...proxies], false);
    let blocked = null;
    for (const hit of hits) {
      const u = hit.object.userData;
      if (u.item) return { ...u.item };                                        // a carve proxy
      const item = u.pick ? u.pick(hit.faceIndex, hit) : null;
      if (!item) continue;
      if (u.block) { if (!blocked) blocked = { kind: item.kind, index: item.index }; continue; }
      return { kind: item.kind, index: item.index };
    }
    return blocked;
  }

  /* ---- handles ---- */
  const handlesEl = () => document.getElementById('handles');
  let layerEl = null, labelEl = null;
  const hEls = {};
  function buildHandleLayer() {
    const host = handlesEl();
    if (!host || layerEl) return;
    layerEl = h('div', { class: 'tower-hdl-layer', hidden: true });
    labelEl = h('div', { class: 'hdl-dim tower-hdl-label', hidden: true, role: 'status' });
    layerEl.append(labelEl);
    for (const [id, kind, text] of HANDLE_DEFS) {
      const el = h('div', { class: `hdl tower-hdl tower-hdl-${kind}`, 'data-handle': id, role: 'button', 'aria-label': text, title: text, hidden: true },
        h('span', { class: 'tower-hdl-glyph', html: GLYPH[kind] }));
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const d = prepareDrag(id, e.clientX, e.clientY, { touch: e.pointerType !== 'mouse' });
        if (!d) return;
        const handler = {
          move: (ev) => queueMove(ev.clientX, ev.clientY, ev.altKey),
          up: () => { flushMove(); endDrag(true); },
          cancel: () => endDrag(false),
        };
        if (!ctx.input.start(handler, e)) { drag = null; return; }
        el.classList.add('active');
      });
      layerEl.append(el);
      hEls[id] = el;
    }
    host.append(layerEl);
  }

  function handleInfo(it) {
    if (!(it.kind === 'segment' || it.kind === 'podium' || it.kind === 'context')) return null;
    const s = store.raw(), d = T.derived.get();
    const fp = footprint(it);
    if (!fp) return null;
    let z0 = 0, z1 = 0;
    if (it.kind === 'context') { const b = s.context.blocks[it.index] || {}; z0 = Number.isFinite(b.base) ? b.base : 0; z1 = z0 + num(b.h, 0); }
    else { const r = zRange(d, it); if (!r) return null; z0 = r.z0; z1 = r.z1; }
    const b = fp.box, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const ex = [1, 0, 0], ey = [0, 1, 0], ez = [0, 0, 1];
    const neg = (v) => v.map((x) => -x);
    const hs = [
      { id: 'move-x', kind: 'move', local: [cx, b.minY, z0], axis: ex, out: neg(ey) },
      { id: 'move-y', kind: 'move', local: [b.minX, cy, z0], axis: ey, out: neg(ex) },
    ];
    if (fp.resizeX) hs.push({ id: 'width', kind: 'resize', local: [b.maxX, cy, z1], axis: ex, out: ex });
    if (fp.resizeY) hs.push({ id: 'depth', kind: 'resize', local: [cx, b.maxY, z1], axis: ey, out: ey });
    hs.push({ id: 'top', kind: 'top', local: [cx, cy, z1], axis: ez, out: null });
    return { item: it, fp, z0, z1, hs };
  }
  const handlesWanted = () => items.length === 1 && ['segment', 'podium', 'context'].includes(items[0].kind) && T.active() && !!ctx.scene.ok;

  const _v = new THREE.Vector3();
  function viewDirAt(P) {
    const cam = ctx.scene.camera();
    if (ctx.scene.cameraType && ctx.scene.cameraType() === 'ortho') return cam.getWorldDirection(new THREE.Vector3());
    return P.clone().sub(cam.position).normalize();
  }
  /** Client px of a world point, relative to the #handles layer. */
  function toLayerPx(v3, rect) {
    const s = ctx.scene.toScreen(v3);
    return { x: s.x - rect.left, y: s.y - rect.top, visible: s.visible };
  }
  function syncHandles() {
    if (!layerEl) return;
    if (!handlesWanted()) { layerEl.hidden = true; if (!drag) labelEl.hidden = true; for (const id of Object.keys(hEls)) hEls[id].hidden = true; return; }
    const info = handleInfo(items[0]);
    if (!info) { layerEl.hidden = true; return; }
    layerEl.hidden = false;
    const host = handlesEl();
    const rect = host.getBoundingClientRect();
    const cam = ctx.scene.camera();
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const elevation = Math.abs(fwd.y) < 0.35;
    const coarse = isCoarse();
    const present = new Set();
    for (const hd of info.hs) {
      const el = hEls[hd.id];
      const anchor = lw(...hd.local);
      const axisW = dirW(...hd.axis);
      const f = viewDirAt(anchor);
      let hide = Math.abs(axisW.dot(f)) > HIDE_DOT || (drag && drag.id !== hd.id);
      const p = toLayerPx(anchor, rect);
      if (!p.visible) hide = true;
      if (hide) { el.hidden = true; continue; }
      let ox = 0, oy = 0;
      if (hd.kind === 'top') { if (elevation) oy = -(coarse ? 30 : 24); }
      else if (hd.kind === 'move' && elevation) oy = coarse ? 32 : 26;
      else if (hd.out) {
        const outW = dirW(...hd.out);
        const q = toLayerPx(anchor.clone().addScaledVector(outW, 1), rect);
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
        const off = (hd.kind === 'move' ? 26 : 18) + (coarse ? 6 : 0);
        if (len > 0.02) { ox = (dx / len) * off; oy = (dy / len) * off; } else oy = off;
      }
      let ang = 0;
      if (hd.kind !== 'top') {
        const q = toLayerPx(anchor.clone().addScaledVector(axisW, 10), rect);
        ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      }
      el.hidden = false;
      el.style.transform = `translate(${(p.x + ox).toFixed(1)}px, ${(p.y + oy).toFixed(1)}px)`;
      const glyph = el.firstChild;
      if (glyph) glyph.style.transform = hd.kind === 'top' ? '' : `rotate(${ang.toFixed(1)}deg)`;
      el.classList.toggle('active', !!drag && drag.id === hd.id);
      present.add(hd.id);
    }
    for (const id of Object.keys(hEls)) if (!present.has(id)) hEls[id].hidden = true;
  }
  const visibleHandles = () => { syncHandles(); return Object.keys(hEls).filter((id) => !hEls[id].hidden && layerEl && !layerEl.hidden); };

  /* ---- drag ---- */
  function ftPerPx(P) {
    const a = ctx.scene.toScreen(P), bx = ctx.scene.toScreen(P.clone().add(new THREE.Vector3(1, 0, 0))), by = ctx.scene.toScreen(P.clone().add(new THREE.Vector3(0, 0, -1)));
    const pf = (Math.hypot(bx.x - a.x, bx.y - a.y) + Math.hypot(by.x - a.x, by.y - a.y)) / 2;
    return pf > 1e-6 ? 1 / pf : 1;
  }
  const snapSettings = () => { const sn = store.get('view.snap') || {}; return { on: sn.on !== false, grid: sn.grid === 10 ? 10 : 5 }; };

  function pointerParam(cx, cy) {
    const ray = ctx.scene.rayFrom(cx, cy).ray;
    const denom = drag.n.dot(ray.direction);
    if (Math.abs(denom) < 1e-5) return null;
    const tt = drag.n.dot(_v.copy(drag.p0).sub(ray.origin)) / denom;
    if (!(ctx.scene.cameraType && ctx.scene.cameraType() === 'ortho') && tt < 0) return null;
    const hit = ray.origin.clone().addScaledVector(ray.direction, tt);
    return hit.sub(drag.p0).dot(drag.axis);
  }
  function prepareDrag(id, cx, cy, opt = {}) {
    if (drag) endDrag(true);
    if (!handlesWanted()) return null;
    const it = items[0];
    const info = handleInfo(it);
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return null;
    const anchor = lw(...hd.local);
    const axis = dirW(...hd.axis);
    const f = viewDirAt(anchor);
    const n = f.clone().addScaledVector(axis, -f.dot(axis));
    if (n.lengthSq() < 1e-8) return null;
    n.normalize();
    const s = store.raw(), d = T.derived.get();
    const snapBox = Snap.itemBox(s, d.plates, it) || info.fp.box;
    const touch = !!opt.touch;
    const centerW = lw((info.fp.box.minX + info.fp.box.maxX) / 2, (info.fp.box.minY + info.fp.box.maxY) / 2, 0);
    drag = {
      id, item: it, info, fp: info.fp, snapBox, p0: anchor, axis, n, t0: 0, touch, orig: {}, pending: null, raf: 0,
      targets: Snap.collectSnapTargets(effectiveState(s), d.plates, { exclude: it }),   // the hidden zoning lot and setbacks are not snap lines (October 28, 2026)
      tol: clamp(ftPerPx(centerW) * (touch ? TOL_PX_TOUCH : TOL_PX), 0.5, 20),
      base: deepClone(it.kind === 'segment' ? s.segments[it.index] : it.kind === 'podium' ? s.podium : s.context.blocks[it.index]),
    };
    const t0 = pointerParam(cx, cy);
    if (t0 == null) { drag = null; return null; }
    drag.t0 = t0;
    lastDrag = { id, label: '', guides: [] };
    return drag;
  }
  function queueMove(cx, cy, alt) {
    if (!drag) return;
    drag.pending = { cx, cy, alt };
    if (!drag.raf) drag.raf = requestAnimationFrame(() => { if (drag) drag.raf = 0; flushMove(); });
  }
  function flushMove() {
    if (!drag || !drag.pending) return;
    const { cx, cy, alt } = drag.pending;
    drag.pending = null;
    dragMove(cx, cy, !!alt);
  }
  function write(path, value) {
    if (!(path in drag.orig)) drag.orig[path] = deepClone(store.get(path));
    store.set(path, value, { live: true });
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
      const res = Snap.snapMove(drag.snapBox, ax === 'x' ? { dx: t, dy: 0 } : { dx: 0, dy: t }, drag.targets, { tolerance: drag.tol, grid: sn.grid, enabled });
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
      const r = Snap.snapEdge(hi + t, ax, drag.targets, { tolerance: drag.tol, grid: 0, enabled, span });
      let ext = r.value - lo;
      if (!r.guide) ext = Snap.snapLength(ext, { step: enabled ? 1 : 0.1 });
      ext = clamp(ext, 1, MAXD);
      if (r.guide && r.guide.kind !== 'grid') guides = [r.guide];
      const center = lo + ext / 2;
      for (const [path, v] of extentWrites(it, fp, ax, rnd(ext, 10000), rnd(center, 10000))) write(path, v);
      label = `${id === 'width' ? 'Width' : 'Depth'} ${fmt(ext)}`;
    } else if (id === 'top') {
      if (it.kind === 'context') {
        const h0 = num(base.h, 0);
        const hh = clamp(Snap.snapLength(h0 + t, { step: enabled ? 1 : 0.1 }), 1, MAXD);
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
    if (!labelEl) return;
    const host = handlesEl();
    const rect = host.getBoundingClientRect();
    labelEl.hidden = false;
    labelEl.textContent = '';
    labelEl.append(h('b', null, text));
    const g = (guides || []).find((x) => x && x.label);
    if (g) labelEl.append(h('span', { class: 'tower-hdl-sub' }, g.label));
    const x = clamp(cx - rect.left + 18, 8, Math.max(8, rect.width - 190)), y = clamp(cy - rect.top - 52, 8, Math.max(8, rect.height - 60));
    labelEl.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    labelEl.style.left = '0'; labelEl.style.top = '0';
  }
  function endDrag(ok = true) {
    if (!drag) return;
    const d = drag;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag = null;
    if (!ok) for (const [path, v] of Object.entries(d.orig)) store.set(path, v, { live: true });
    store.commit();
    clearGroup(guideGroup);
    if (labelEl) labelEl.hidden = true;
    for (const el of Object.values(hEls)) el.classList.remove('active');
    ctx.scene.requestRender();
    syncHandles();
  }

  /** Test hook: the same drag math as a real drag, driven by world deltas (feet) along the handle axis. */
  function simulateHandleDrag(id, amount = 0, opts = {}) {
    if (drag) endDrag(true);
    const info = items.length === 1 ? handleInfo(items[0]) : null;
    const hd = info && info.hs.find((x) => x.id === id);
    if (!hd) return null;
    const anchor = lw(...hd.local), axis = dirW(...hd.axis);
    const target = anchor.clone().addScaledVector(axis, amount);
    const p0 = ctx.scene.toScreen(anchor), p1 = ctx.scene.toScreen(target);
    if (!prepareDrag(id, p0.x, p0.y, { touch: !!opts.touch })) return null;
    const res = dragMove(p1.x, p1.y, !!opts.alt);
    if (!opts.hold) endDrag(true);
    return res;
  }

  /* ---- selection actions ---- */
  function setItems(next, { card = true } = {}) {
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
    if (changed || card) onChanged({ card });
    return changed;
  }
  const toggleItem = (it) => {
    const n = normItem(it);
    return setItems(items.some((o) => sameItem(o, n)) ? items.filter((o) => !sameItem(o, n)) : [...items, n]);
  };
  const clear = () => setItems([]);

  function showCard() {
    suppress = true;
    try {
      if (!items.length) { ctx.select(null); return; }
      if (items.length === 1) ctx.select(cardItem(items[0]), CONFIG.tool);
      else {
        const counts = {};
        for (const i of items) counts[i.kind] = (counts[i.kind] || 0) + 1;
        ctx.select({
          id: 'tower:many', kind: 'many', index: 0, title: `${items.length} items`, owner: CONFIG.tool, tool: CONFIG.tool,
          rows: Object.entries(counts).map(([k, n]) => [k[0].toUpperCase() + k.slice(1), String(n)]),
        }, CONFIG.tool);
      }
    } finally { suppress = false; }
  }
  function onChanged({ card = true } = {}) {
    if (card) showCard();
    refreshOverlay();
    syncHandles();
    T.gizmoSync();
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
    const next = deepClone(store.raw());
    let removed = 0;
    let segIdx = [...new Set(sel.filter((i) => i.kind === 'segment').map((i) => i.index))].sort((a, b) => a - b);
    if (segIdx.length && segIdx.length >= next.segments.length) {
      segIdx = segIdx.slice(1);                  // never delete the last segment: the lowest one stays
      ctx.ui.Toast.show('A tower needs at least one segment, so one was kept.', { kind: 'warn' });
    }
    for (const i of segIdx.slice().reverse()) { next.segments.splice(i, 1); removed++; }
    for (const i of [...new Set(sel.filter((x) => x.kind === 'carve').map((x) => x.index))].sort((a, b) => b - a)) { next.carves.splice(i, 1); removed++; }
    for (const i of [...new Set(sel.filter((x) => x.kind === 'context').map((x) => x.index))].sort((a, b) => b - a)) { next.context.blocks.splice(i, 1); removed++; }
    if (sel.some((x) => x.kind === 'podium') && next.podium.on) { next.podium.on = false; removed++; }
    if (sel.some((x) => x.kind === 'crown') && next.crown.type !== 'none') { next.crown.type = 'none'; removed++; }
    if (!removed) return 0;
    store.replace(next);
    setItems([]);
    return removed;
  }
  const deleteSelection = () => deleteItems(items);

  function copySegment(index, where = 'above') {
    const s = store.raw();
    if (!s.segments[index]) return false;
    const next = deepClone(s);
    const at = where === 'below' ? index : index + 1;
    next.segments.splice(at, 0, deepClone(next.segments[index]));
    store.replace(next);
    setItems([{ kind: 'segment', index: at }]);
    return at;
  }
  function copySelected(where = 'above') {
    if (items.length === 1 && items[0].kind === 'segment') return copySegment(items[0].index, where);
    ctx.ui.Toast.show('Select one segment to copy it.', { kind: 'info', ms: 2200 });
    return false;
  }

  /* ---- shell hooks ---- */
  function onTap(ev) {
    if (!T.active() || !ctx.scene.ok) return false;
    const hit = pickAt(ev.clientX, ev.clientY);
    const additive = ev.shiftKey || addMode;
    if (hit) { if (additive) toggleItem(hit); else setItems([hit]); return true; }
    return false;
  }
  /** The shell cleared or changed the selection (Esc, a tap elsewhere, a tool switch). */
  function onShellSelection({ item, owner }) {
    if (suppress) return;
    if (item && owner === CONFIG.tool) return;
    if (items.length) { items = []; addMode = false; if (drag) endDrag(false); refreshOverlay(); syncHandles(); T.gizmoSync(); }
  }
  /** Extra buttons on the selection card. */
  function cardActions(item) {
    if (!item || item.owner !== CONFIG.tool) return [];
    const out = [];
    if (items.length === 1 && items[0].kind === 'segment') {
      out.push({ label: 'Copy above', action: () => copySegment(items[0].index, 'above') }, { label: 'Copy below', action: () => copySegment(items[0].index, 'below') });
    }
    if (items.length) {
      out.push({ label: addMode ? 'Done adding' : 'Select more', action: () => { addMode = !addMode; showCard(); } });
      out.push({ label: 'Delete', action: () => deleteSelection() });
    }
    return out;
  }

  function onStore() {
    if (!overlayOn) return;
    sanitize();
    if (items.length || carvesVisible()) scheduleOverlay();
  }
  let overlayRaf = 0;
  function scheduleOverlay() {
    if (overlayRaf) return;
    overlayRaf = requestAnimationFrame(() => {
      overlayRaf = 0;
      refreshOverlay();
      if (items.length) showCard();          // the card rows follow the design
    });
  }

  let offFrame = null, offKeys = [];
  function enable() {
    if (overlayOn) return;
    overlayOn = true;
    ctx.scene.overlayRoot.add(root);
    buildHandleLayer();
    if (!offFrame) offFrame = ctx.scene.onFrame(() => { if (overlayOn) { placeRoot(); syncHandles(); } });
    refreshOverlay();
    syncHandles();
  }
  function disable() {
    if (!overlayOn) return;
    if (drag) endDrag(false);
    overlayOn = false;
    if (offFrame) { offFrame(); offFrame = null; }
    items = []; addMode = false;
    clearGroup(outlineGroup); clearGroup(carveGroup); clearGroup(guideGroup); clearGroup(pickGroup);
    if (root.parent) root.parent.remove(root);
    if (layerEl) layerEl.hidden = true;
    for (const el of Object.values(hEls)) el.hidden = true;
    ctx.scene.requestRender();
  }
  function bindKeys() {
    const k = ctx.keys;
    offKeys = [
      k.bind(CONFIG.tool, 'Delete', () => { if (!items.length) return false; deleteSelection(); return true; }),
      k.bind(CONFIG.tool, 'Backspace', () => { if (!items.length) return false; deleteSelection(); return true; }),
      k.bind(CONFIG.tool, 'mod+d', () => { copySelected('above'); return true; }),
    ];
  }
  function dispose() { disable(); offKeys.forEach((f) => f()); offKeys = []; if (layerEl) layerEl.remove(); layerEl = null; }

  return {
    enable, disable, bindKeys, dispose, onStore, onTap, onShellSelection, cardActions, cardItem,
    select: (list) => setItems(list), add: (it) => setItems([...items, it]), toggle: toggleItem, clear,
    get: () => items.map((i) => ({ ...i })), count: () => items.length,
    deleteSelection, deleteItems, copySegment, copySelected,
    pickAt, visibleHandles, simulateHandleDrag, refreshOverlay, syncHandles,
    handlesShown: () => handlesWanted() && items.length === 1,
    dragging: () => !!drag, lastDrag: () => lastDrag, cancelDrag: () => endDrag(false),
    addMode: () => addMode, setAddMode: (v) => { addMode = !!v; if (items.length) showCard(); },
    onChange: (fn) => listeners.push(fn),
    carvesVisible, footprint, itemName,
  };
}
