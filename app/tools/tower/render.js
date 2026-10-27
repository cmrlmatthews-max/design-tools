/* ==========================================================================
   TOWER: live layer builders
   Port of buildFloorObjects / buildContextObjects / buildEnvelopeObjects in build/tower/06_render.js.
   Every builder returns a THREE.Group in the tower LOCAL frame (plan x, y; elevation above baseZ). The tool places the
   group in the scene with ctx.frame.placeGroup(group, placement).
   Floors are merged by material key (model / outside / prog:<k>:<color> / zone:<k>), one mesh per key. A table of triangle
   ranges maps a raycast face back to its item ({ kind: 'segment' | 'podium' | 'crown', index }).
   Materials belong to the group (core/layers.js disposes them with it), nothing is shared between builds.
   ========================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planMatrix, planToWorld } from '../../core/frame.js';
import { css } from '../../core/scene.js';
import { CONFIG, num, sitePolygon } from './state.js';

const HERO = new THREE.Color(CONFIG.heroColor);
const AI_CONTEXT = '#c9cdd2';

/* ---------- geometry ---------- */

export function extrudePolys(polygons, z, depth) {
  const shapes = polygons.map((poly) => {
    const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q[0], q[1])));
    for (const h of poly.holes || []) shape.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
    return shape;
  });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(0.05, depth), bevelEnabled: false, steps: 1, curveSegments: 1 });
  geo.deleteAttribute('uv');
  geo.applyMatrix4(planMatrix(z));
  return geo;
}
export function meshSolidGeometry(s) {
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(s.positions, 3));
  geo.setIndex(s.indices);
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();                  // flat normals
  geo.applyMatrix4(planMatrix(0));
  return geo;
}
export function solidGeometry(s) {
  return s.kind === 'mesh' ? meshSolidGeometry(s) : extrudePolys(s.polygons, s.z0, Math.max(0.05, s.z1 - s.z0));
}
const triCount = (geo) => Math.round(geo.getAttribute('position').count / 3);

export function plateItem(plate) {
  return plate.zone === 'podium' ? { kind: 'podium', index: 0 } : { kind: 'segment', index: plate.segmentIndex | 0 };
}

/* ---------- materials ---------- */

function materialFor(key, style) {
  const ds = key.endsWith('|ds');
  const k = ds ? key.slice(0, -3) : key;
  const side = ds ? THREE.DoubleSide : THREE.FrontSide;
  const diagram = style === 'diagram';
  const flat = (color) => new THREE.MeshBasicMaterial({ color, side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  if (k === 'model') return new THREE.MeshStandardMaterial({ color: css('--scene-model', '#efefec'), roughness: 0.94, metalness: 0, side });
  if (k === 'outside') {
    return diagram ? flat(new THREE.Color(CONFIG.outsideColor))
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.outsideColor), roughness: 0.85, metalness: 0, side });
  }
  if (k.startsWith('prog:')) return flat(new THREE.Color(k.split(':')[2] || '#999999'));
  return flat(new THREE.Color(CONFIG.zoneColors[k.slice(5)] || '#999999'));
}
const lineMat = (name, opts = {}) => new THREE.LineBasicMaterial({ color: css(name, '#e7eaee'), ...opts });

export function plateMaterialKey(plate, view, programs, style) {
  if (plate.outsideEnvelopeArea > 1) return 'outside';
  if (style !== 'diagram') return 'model';
  if (view.colorBy === 'program') return `prog:${plate.program}:${((programs[plate.program] || CONFIG.programs[plate.program] || {}).color) || '#999999'}`;
  return `zone:${plate.zone}`;
}

/* ---------- the model ---------- */

/**
 * Floors, crown and the tower's own site outline.
 * opts: { style: 'model'|'diagram', disp: { plates, solids, solidsOutside }, itemFor(item) -> card item, showSite (default true): draw the site outline }
 */
export function buildModelGroup(state, opts) {
  const { disp, style, itemFor, showSite = true } = opts;
  const view = state.view, diagram = style === 'diagram';
  const gap = view.floorLines ? CONFIG.floorGap : 0;
  const group = new THREE.Group();
  group.name = 'tower-model';
  const groups = new Map();                       // key -> [{ geo, item }]
  const push = (key, geo, item) => {
    const pos = geo.getAttribute('position');
    if (!pos || pos.count === 0) { geo.dispose(); return; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ geo, item });
  };
  for (const plate of disp.plates) {
    if (plate.void || !plate.polygons.length) continue;
    try { push(plateMaterialKey(plate, view, state.programs, style), extrudePolys(plate.polygons, plate.z, Math.max(0.1, plate.ftf - gap)), plateItem(plate)); }
    catch (e) { console.error(e); }
  }
  disp.solids.forEach((s, i) => {
    let geo;
    try { geo = solidGeometry(s); } catch (e) { console.error(e); return; }
    const base = disp.solidsOutside[i] ? 'outside' : (diagram ? 'zone:crown' : 'model');
    push(s.kind === 'mesh' ? `${base}|ds` : base, geo, { kind: 'crown', index: 0 });
  });
  for (const [key, list] of groups) {
    const ranges = [];
    let end = 0;
    for (const e of list) { end += triCount(e.geo); ranges.push({ end, item: e.item }); }
    const geos = list.map((e) => e.geo);
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materialFor(key, style));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.model = true;
    mesh.userData.hero = true;
    mesh.userData.ranges = ranges;
    mesh.userData.pick = (faceIndex) => {
      let lo = 0, hi = ranges.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (faceIndex < ranges[mid].end) hi = mid; else lo = mid + 1; }
      const it = ranges[lo] && ranges[lo].item;
      return it && itemFor ? itemFor(it) : null;
    };
    group.add(mesh);
    if (diagram) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 20), lineMat('--scene-edge'));
      edges.userData.edges = true;
      group.add(edges);
    }
  }
  // The tower's own site outline (rectangle or polygon), just above the base.
  const ring = showSite ? sitePolygon(state) : [];
  if (ring.length) {
    const pts = ring.map((q) => new THREE.Vector3(...planToWorld(q[0], q[1], 0.1)));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat('--scene-site', { color: css('--scene-site', '#6aa2ea') }));
    line.userData.siteLine = true;
    group.add(line);
  }
  group.userData.count = disp.plates.filter((p) => !p.void && p.polygons.length).length;
  return group;
}

/* ---------- context blocks ---------- */

/** Boxes around the building. skipSite: leave out the blocks that came from the site (the site layer draws those). */
export function buildContextGroup(state, opts) {
  const { style, skipSite, itemFor } = opts;
  const diagram = style === 'diagram';
  const group = new THREE.Group();
  group.name = 'tower-context';
  const mat = new THREE.MeshStandardMaterial({ color: css('--scene-context', '#6f7882'), roughness: 0.95, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
  const edgeMat = lineMat('--scene-grid-major', { color: css('--scene-grid-major', '#6e7781') });
  let n = 0;
  (state.context.blocks || []).forEach((b, i) => {
    if (skipSite && b.site) return;
    const w = num(b.w, 0), d = num(b.d, 0), hgt = num(b.h, 0);
    if (!(w > 0 && d > 0 && hgt > 0)) return;
    const base = Number.isFinite(b.base) ? b.base : 0;
    const geo = new THREE.BoxGeometry(w, d, hgt);          // plan x, y, elevation
    geo.translate(num(b.x, 0), num(b.y, 0), base + hgt / 2);
    geo.applyMatrix4(planMatrix(0));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.visible = !diagram;
    mesh.userData.model = true;
    mesh.userData.block = true;
    mesh.userData.item = { kind: 'context', index: i };
    mesh.userData.pick = () => (itemFor ? itemFor({ kind: 'context', index: i }) : null);
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.visible = diagram;
    edges.userData.edges = true;
    group.add(edges);
    n++;
  });
  group.userData.count = n;
  return group;
}

/* ---------- envelope ---------- */

/** Transparent wireframe of the allowed envelope (setbacks, stepback, height limit). */
export function buildEnvelopeGroup(state, wire) {
  const group = new THREE.Group();
  group.name = 'tower-envelope';
  if (!state.view.envelope || !wire || !wire.length) return group;
  const pos = [];
  const seg = (a, b) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
  for (const prism of wire) {
    for (const poly of prism.polygons) {
      for (const ring of [poly.outer, ...(poly.holes || [])]) {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n];
          seg(planToWorld(a[0], a[1], prism.z0), planToWorld(b[0], b[1], prism.z0));
          seg(planToWorld(a[0], a[1], prism.z1), planToWorld(b[0], b[1], prism.z1));
          seg(planToWorld(a[0], a[1], prism.z0), planToWorld(a[0], a[1], prism.z1));
        }
      }
    }
  }
  if (!pos.length) return group;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, lineMat('--scene-env', { color: css('--scene-env', '#e6a64a'), transparent: true, opacity: 0.75, depthWrite: false }));
  lines.renderOrder = 3;
  lines.userData.envelope = true;
  group.add(lines);
  group.userData.count = 1;
  return group;
}

/* ---------- AI-ready look ---------- */

const stash = new WeakMap();           // mesh -> { material }

/** Hero amber for the model; opaque light-gray context; no edges, no outline, no envelope. */
export function aiReadyModel(obj, on) {
  obj.traverse((o) => {
    if (o.isMesh && o.userData.hero) {
      if (on && !stash.has(o)) {
        stash.set(o, { material: o.material });
        o.material = new THREE.MeshStandardMaterial({ color: HERO, roughness: 0.94, metalness: 0, side: o.material.side });
      } else if (!on && stash.has(o)) {
        const s = stash.get(o);
        const hero = o.material;
        o.material = s.material;
        stash.delete(o);
        try { hero.dispose(); } catch (e) { /* ignore */ }
      }
    } else if (o.userData.edges || o.userData.siteLine) {
      if (on) { o.userData.wasVisible = o.visible; o.visible = false; } else if ('wasVisible' in o.userData) { o.visible = o.userData.wasVisible; delete o.userData.wasVisible; }
    }
  });
}
export function aiReadyContext(obj, on) {
  obj.traverse((o) => {
    if (o.isMesh && o.userData.block) {
      if (on && !stash.has(o)) {
        stash.set(o, { material: o.material, visible: o.visible });
        o.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(AI_CONTEXT), roughness: 0.95, metalness: 0 });
        o.visible = true;
      } else if (!on && stash.has(o)) {
        const s = stash.get(o);
        const solid = o.material;
        o.material = s.material; o.visible = s.visible;
        stash.delete(o);
        try { solid.dispose(); } catch (e) { /* ignore */ }
      }
    } else if (o.userData.edges) {
      if (on) { o.userData.wasVisible = o.visible; o.visible = false; } else if ('wasVisible' in o.userData) { o.visible = o.userData.wasVisible; delete o.userData.wasVisible; }
    }
  });
}
export function aiReadyEnvelope(obj, on) {
  if (on) { obj.userData.wasVisible = obj.visible; obj.visible = false; } else if ('wasVisible' in obj.userData) { obj.visible = obj.userData.wasVisible; delete obj.userData.wasVisible; }
}
/** Frees materials the AI-ready look made, in case the group goes away while it is on. */
export function disposeAiReady(obj) {
  obj.traverse((o) => {
    if (stash.has(o)) {
      const s = stash.get(o);
      try { o.material.dispose(); } catch (e) { /* ignore */ }
      o.material = s.material;
      stash.delete(o);
    }
  });
}
