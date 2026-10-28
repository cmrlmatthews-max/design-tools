/* ==========================================================================
   CORE: derived layers (app/CONTRACT.md section 10, docs/shell-plan.md sections 5 to 7)
   Draws every project section from its `derived` block, the Model Viewer's job (build/viewer/04_render.js), through
   src/viewer/scene.js (layersFrom, levelsIndex, cutAt, colorKey, colorOf). A tool that is loaded draws its own live
   layer and hides the derived twin with def.replaces.

   Layer ids and owners:
     site-ground, site-neighbors, site-roads, site-water   owner 'site'   (core/sitelayer3d.js)
     massing                                                owner 'tower' ('midrise' when massing.tool is 'midrise')
     units, cores                                           owner 'plates'
     parking                                                owner 'parking'
     grading                                                owner 'grading'

   Frames: layersFrom gives items in the PROJECT frame. Everything draws in the shifted scene (project minus
   frame.getShift()). The site layer data is built with the placement { x: shift.x, y: shift.y, rotation: 0,
   baseZ: shift.z }: the site section placement is the identity, so its local frame is then the scene frame.

   Ground (shell-plan section 7): while the grading layer is on and has a proposed ground, it sets the ground override
   (owner 'grading:derived', only when no live Grading tool holds it). The site ground layer then hides its ground mesh
   (it keeps the boundary), roads and walks drape on the proposed ground, and the grading layer draws the proposed
   ground mesh plus a light wire of the existing ground where it differs.

   Colors: Model style draws plain solids; Diagram colors by program, units by unit type. The cut level draws in plan
   colors in both styles. AI-ready: massing, units and cores amber (#E0A458), the rest white.
   ========================================================================== */
import { coverKey, coveredMassingIndices, platesCurrent } from './cover.js';
import * as THREE from 'three';
import { getSection, toLocal } from '../../src/shared/project.js';
import { layersFrom, cutAt, colorKey, colorOf, DEFAULT_ON } from '../../src/viewer/scene.js';
import { buildSiteLayerData } from '../../src/shared/sitelayer.js';
import { buildMerged } from './layers.js';
import { getShift, worldVec } from './frame.js';
import { css as sceneCss } from './scene.js';
import * as SiteLayer3D from './sitelayer3d.js';

export const HERO_COLOR = '#E0A458';
export const WHITE_COLOR = '#f6f6f3';
const HERO_LAYERS = new Set(['massing', 'units', 'cores']);
const AI_EDGE = '#20262d';          // edges on the light AI-ready sky
const STALL_MODEL = '#c3c8cd';
const EXISTING_WIRE = '#8e98a3';
// Cut and fill map of the Grading Sketch (build/grading/01_config.js): fill blue, cut red, five steps each.
const DIFF_EDGES = [1, 2, 4, 8];
const FILL_COLORS = ['#cde2f5', '#9cc6ec', '#6199d6', '#3470b8', '#1c478a'];
const CUT_COLORS = ['#f7d3cb', '#eda697', '#dc7366', '#c1433a', '#8f2a24'];
const NO_CHANGE = 0.05;
const NO_CHANGE_COLOR = '#f3f3ef';
const OVERRIDE_OWNER = 'grading:derived';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cssColor = (name, fb) => { try { return sceneCss(name, fb); } catch (e) { return new THREE.Color(fb || '#888888'); } };

function stampOf(doc, key) {
  const s = getSection(doc, key);
  return s ? `${key}:${s.updatedAt || ''}` : `${key}:-`;
}
const shiftKey = (sh) => `${sh.x},${sh.y},${sh.z}`;

function diffColor(diff) {
  const a = Math.abs(diff);
  if (a < NO_CHANGE) return NO_CHANGE_COLOR;
  let i = 0;
  while (i < DIFF_EDGES.length && a >= DIFF_EDGES[i]) i++;
  return diff > 0 ? FILL_COLORS[i] : CUT_COLORS[i];
}

/** The color of an item (the Model Viewer Paint rule, build/viewer/04_render.js). */
export function itemHex(item, { style = 'model', aiReady = false, model = '#efefec', context = '#6f7882' } = {}) {
  if (aiReady) return HERO_LAYERS.has(item.layer) ? HERO_COLOR : WHITE_COLOR;
  if (item.kind === 'neighbor') return context;
  let k = null;
  if (item.cut && item.layer === 'units') k = colorKey(item, 'unitType');
  else if (item.cut && style !== 'diagram') k = colorKey(item, 'program');
  else if (style === 'diagram') k = colorKey(item, item.layer === 'units' ? 'unitType' : 'program');
  if (k) return colorOf(k);
  return item.kind === 'stall' ? STALL_MODEL : model;
}

/**
 * The derived layer defs. opts: { getDoc, ground, scene, siteStyle?: () => 'solid'|'glass'|'wireframe' }.
 * The site style also comes from ctx.siteStyle (a string or a function) when opts.siteStyle is missing.
 */
export function derivedLayerDefs({ getDoc, ground, scene, siteStyle } = {}) {
  const docNow = (ctx) => {
    try { if (typeof getDoc === 'function') return getDoc(); } catch (e) { /* fall through */ }
    return (ctx && ctx.doc) || null;
  };
  const styleNow = (ctx) => (ctx && (ctx.style === 'diagram' || ctx.style === 'model') ? ctx.style : (() => { try { return scene && scene.style ? scene.style() : 'model'; } catch (e) { return 'model'; } })());
  const siteStyleNow = (ctx) => {
    let v = null;
    try { v = typeof siteStyle === 'function' ? siteStyle() : ctx && typeof ctx.siteStyle === 'function' ? ctx.siteStyle() : ctx ? ctx.siteStyle : null; } catch (e) { v = null; }
    return SiteLayer3D.STYLES.includes(v) ? v : 'solid';
  };
  const groundTag = () => { try { return ground ? `${ground.hasOverride() ? 'ov' : 'ex'}${ground.version ? ground.version() : ''}` : 'none'; } catch (e) { return 'none'; } };

  /* ---- layersFrom, once per document; the cut, once per (document, level) ---- */
  let allMemo = { doc: undefined, all: null };
  let cutMemo = { doc: undefined, z: null, layers: null };
  function all(doc) {
    if (!doc) return null;
    if (allMemo.doc !== doc) {
      let a = null;
      try { a = layersFrom(doc); } catch (e) { console.error(e); a = null; }
      allMemo = { doc, all: a };
    }
    return allMemo.all;
  }
  function shown(doc, cut) {
    const a = all(doc);
    if (!a || !cut || !fin(cut.z)) return a;
    if (cutMemo.doc !== doc || cutMemo.z !== cut.z) {
      let c = null;
      try { c = cutAt(a, cut.z); } catch (e) { console.error(e); c = a; }
      cutMemo = { doc, z: cut.z, layers: c };
    }
    return cutMemo.layers;
  }

  /* ---- site layer data, once per (site section, shift) ---- */
  let siteMemo = { sec: undefined, sk: null, data: null };
  function siteData(doc, sh) {
    const sec = getSection(doc, 'site');
    const dv = sec && isObj(sec.derived) && Object.keys(sec.derived).length ? sec.derived : null;
    if (!dv) return null;
    const sk = shiftKey(sh);
    if (siteMemo.sec !== sec || siteMemo.sk !== sk) {
      let data = null;
      try { data = buildSiteLayerData(dv, { x: sh.x, y: sh.y, rotation: 0, baseZ: sh.z }, { contextIds: new Set() }); } catch (e) { console.error(e); data = null; }
      siteMemo = { sec, sk, data: data && data.ok ? data : null };
    }
    return siteMemo.data;
  }

  /** zAt for draped site parts in scene coordinates: the override where it has a value, else the drawn site ground. */
  function drapeZ(data, sh) {
    const sampler = SiteLayer3D.makeSampler(data.ground);
    const base = sampler || (() => 0);
    if (!ground || !ground.hasOverride()) return base;
    return (x, y) => {
      const z = ground.at(x + sh.x, y + sh.y);
      return fin(z) ? z - sh.z : base(x, y);
    };
  }

  function siteDef({ id, label, order, parts }) {
    return {
      id, label, owner: 'site', order, defaultOn: DEFAULT_ON.site !== false,
      key(ctx) {
        const doc = docNow(ctx);
        const tag = id === 'site-ground' || id === 'site-roads' ? groundTag() : '';
        return [doc ? doc.id : '-', stampOf(doc, 'site'), shiftKey(getShift()), styleNow(ctx), tag].join('|');
      },
      build(ctx) {
        const doc = docNow(ctx);
        if (!doc) return null;
        const sh = getShift();
        const data = siteData(doc, sh);
        if (!data) return null;
        const p = parts.filter((x) => !(x === 'ground' && ground && ground.hasOverride()));
        if (!p.length) return null;
        let res = null;
        try { res = SiteLayer3D.objects(data, { parts: p, style: 'solid', edges: true, shadows: true, rotation: 0, css: cssColor, zAt: drapeZ(data, sh) }); } catch (e) { console.error(e); return null; }
        if (!res.objects.length) return null;
        const g = new THREE.Group();
        for (const o of res.objects) g.add(o);
        g.userData.info = res.info;
        g.userData.count = id === 'site-ground' ? (res.info.ground ? 1 : 0) : id === 'site-roads' ? res.info.roads + res.info.walks : id === 'site-water' ? res.info.waterAreas + (data.water.lines || []).length : res.objects.length;
        if (!g.userData.count && id !== 'site-ground') { SiteLayer3D.dispose(res.objects); return null; }
        return g;
      },
      dispose(obj) { SiteLayer3D.dispose(obj.children); },
    };
  }

  /** A layer of solid items from layersFrom. */
  // Units and cores draw only while they match the massing (core/cover.js platesCurrent); out of date, the massing draws.
  const platesStale = (ctx) => !platesCurrent(docNow(ctx));
  function solidDef({ id, label, listed = true, order, owner, layerIds, sections, defaultOn, extraKey, materialFor, keep, hideWhen, pickable = true }) {
    const def = {
      id, label, listed, order, defaultOn,
      key(ctx) {
        const doc = docNow(ctx);
        const cut = ctx && ctx.cut ? ctx.cut.key : '';
        return [doc ? doc.id : '-', ...sections.map((s) => stampOf(doc, s)), styleNow(ctx), cut, shiftKey(getShift()), ctx && ctx.aiReady ? 'ai' : '', extraKey ? extraKey(ctx) : ''].join('|');
      },
      build(ctx) {
        if (hideWhen && hideWhen(ctx)) return null;
        const doc = docNow(ctx);
        const L = shown(doc, ctx && ctx.cut);
        if (!L) return null;
        const items = [];
        const keepIt = keep ? keep(doc) : null;
        for (const lid of layerIds) if (L[lid] && L[lid].ok) for (const it of L[lid].items) if (it.kind !== 'ground' && (!keepIt || keepIt(it))) items.push(it);
        if (!items.length) return null;
        const own = typeof owner === 'function' ? owner(doc) : owner;
        const opts = { style: styleNow(ctx), aiReady: !!(ctx && ctx.aiReady), model: '#' + cssColor('--scene-model', '#efefec').getHexString(), context: '#' + cssColor('--scene-context', '#6f7882').getHexString() };
        const mat = materialFor ? materialFor(ctx) : null;
        const g = buildMerged(items, {
          shift: getShift(), colorOf: (it) => itemHex(it, opts), edges: true,
          edgeColor: cssColor('--scene-edge', '#e7eaee'), edgeOpacity: mat && mat.edgeOpacity ? mat.edgeOpacity : 0.55,
          material: mat ? mat.material : undefined, castShadow: mat ? mat.castShadow : true, receiveShadow: mat ? mat.receiveShadow : true,
        });
        if (!g.userData.count) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); return null; }
        const mesh = g.userData.mesh;
        if (mesh && !pickable) { mesh.userData.pick = () => null; mesh.userData.occludes = false; }
        else if (mesh) {
          const inner = mesh.userData.pick;
          mesh.userData.pick = (fi) => {
            const it = inner(fi);
            if (!it) return null;
            return { ...it, title: it.data ? it.data.title : it.id, rows: it.data ? it.data.rows : [], owner: own, layer: id };
          };
          if (mat && mat.renderOrder) mesh.renderOrder = mat.renderOrder;
        }
        g.userData.paintOpts = opts;
        return g;
      },
      /** AI-ready: amber hero, white rest, dark edges on the light sky. Repaints in place, no rebuild. */
      aiReady(obj, on) {
        if (!obj || !obj.userData.paint) return;
        const o = { ...(obj.userData.paintOpts || {}), aiReady: !!on };
        obj.userData.paint((it) => itemHex(it, o));
        obj.traverse((x) => {
          if (!x.userData || !x.userData.edges || !x.material) return;
          if (on) { if (x.userData.edgeWas === undefined) x.userData.edgeWas = x.material.color.getHex(); x.material.color.set(AI_EDGE); }
          else if (x.userData.edgeWas !== undefined) { x.material.color.setHex(x.userData.edgeWas); delete x.userData.edgeWas; }
        });
      },
    };
    if (typeof owner === 'function') Object.defineProperty(def, 'owner', { enumerable: true, get: () => owner(docNow(null)) });
    else def.owner = owner;
    return def;
  }

  /* ---- grading: the proposed ground and the override ---- */
  let gradMemo = { sec: undefined, grid: null, fn: null };
  /** { n, spacing, pl, pts (project [x, y, z]), x0, y0 } of grading.derived.ground, or null. */
  function gradingGrid(doc) {
    const sec = getSection(doc, 'grading');
    if (gradMemo.sec === sec) return gradMemo.grid;
    let grid = null;
    const g = sec && isObj(sec.derived) && isObj(sec.derived.ground) ? sec.derived.ground : null;
    if (g && Number.isInteger(g.n) && g.n >= 2 && fin(g.spacing) && g.spacing > 0 && Array.isArray(g.points) && g.points.length === g.n * g.n && g.points.every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]) && fin(p[2]))) {
      const p = isObj(sec.placement) ? sec.placement : {};
      const pl = { x: fin(p.x) ? p.x : 0, y: fin(p.y) ? p.y : 0, rotation: fin(p.rotation) ? p.rotation : 0, baseZ: fin(p.baseZ) ? p.baseZ : 0 };
      const r = (pl.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      const pts = g.points.map((q) => [q[0] * c - q[1] * s + pl.x, q[0] * s + q[1] * c + pl.y, q[2] + pl.baseZ]);
      grid = { n: g.n, spacing: g.spacing, pl, local: g.points, pts, x0: g.points[0][0], y0: g.points[0][1] };
    }
    const fn = grid ? (x, y) => {
      const [lx, ly] = grid.pl.rotation ? toLocal(grid.pl, [x, y]) : [x - grid.pl.x, y - grid.pl.y];
      const L = grid.n - 1, fi = (lx - grid.x0) / grid.spacing, fj = (ly - grid.y0) / grid.spacing;
      if (!(fi >= -1e-6 && fi <= L + 1e-6 && fj >= -1e-6 && fj <= L + 1e-6)) return null;
      const ci = Math.min(Math.max(fi, 0), L), cj = Math.min(Math.max(fj, 0), L);
      const i = Math.min(Math.floor(ci), L - 1), j = Math.min(Math.floor(cj), L - 1), tx = ci - i, ty = cj - j, n = grid.n, o = j * n + i, P = grid.local;
      const z = P[o][2] * (1 - tx) * (1 - ty) + P[o + 1][2] * tx * (1 - ty) + P[o + n][2] * (1 - tx) * ty + P[o + n + 1][2] * tx * ty;
      return fin(z) ? z + grid.pl.baseZ : null;
    } : null;
    gradMemo = { sec, grid, fn };
    return grid;
  }

  function gradingGroundObjects(doc, ctx, groundItem) {
    const grid = gradingGrid(doc);
    if (!grid) return [];
    const sh = getShift();
    let data = null;
    try { data = buildSiteLayerData({ ground: { n: grid.n, spacing: grid.spacing, points: grid.pts } }, { x: sh.x, y: sh.y, rotation: 0, baseZ: sh.z }); } catch (e) { console.error(e); data = null; }
    if (!data || !data.ok || !data.ground) return [];
    let res = null;
    try { res = SiteLayer3D.objects(data, { parts: ['ground'], css: cssColor, shadows: true }); } catch (e) { console.error(e); return []; }
    const out = [];
    const exist = (k) => (ground ? ground.existingAt(grid.pts[k][0], grid.pts[k][1]) : null);
    for (const o of res.objects) {
      o.userData.kind = o.userData.kind === 'site-ground' ? 'grading-ground' : o.userData.kind === 'site-skirt' ? 'grading-skirt' : o.userData.kind;
      if (o.userData.kind === 'grading-ground') {
        o.userData.isGround = true;
        const item = { ...groundItem, title: groundItem.data.title, rows: groundItem.data.rows, owner: 'grading', layer: 'grading' };
        o.userData.pick = () => item;
        if (styleNow(ctx) === 'diagram' && !(ctx && ctx.aiReady)) {
          const col = o.geometry.getAttribute('color'), c = new THREE.Color();
          for (let k = 0; k < grid.pts.length; k++) {
            const e = exist(k);
            c.set(fin(e) ? diffColor(grid.pts[k][2] - e) : NO_CHANGE_COLOR);
            col.setXYZ(k, c.r, c.g, c.b);
          }
          col.needsUpdate = true;
        }
      }
      out.push(o);
    }
    // the existing ground as a light wire where it differs (build/grading/05c_ground3d.js existingWire)
    if (ground) {
      const n = grid.n, ez = grid.pts.map((p, k) => exist(k));
      if (ez.every(fin)) {
        const changed = (i, j) => { for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const k = (j + dj) * n + i + di; if (Math.abs(grid.pts[k][2] - ez[k]) > 0.05) return true; } return false; };
        const P = (i, j) => { const k = j * n + i; return worldVec(grid.pts[k][0] - sh.x, grid.pts[k][1] - sh.y, ez[k] - sh.z); };
        const segs = [];
        for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
          if (!changed(i, j)) continue;
          segs.push(P(i, j), P(i + 1, j), P(i, j), P(i, j + 1));
          if (i === n - 2 || !changed(i + 1, j)) segs.push(P(i + 1, j), P(i + 1, j + 1));
          if (j === n - 2 || !changed(i, j + 1)) segs.push(P(i, j + 1), P(i + 1, j + 1));
        }
        if (segs.length) {
          const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: EXISTING_WIRE, transparent: true, opacity: 0.38, depthWrite: false }));
          ls.renderOrder = 3; ls.raycast = () => {}; ls.userData.kind = 'grading-existing-wire';
          out.push(ls);
        }
      }
    }
    return out;
  }

  const massingOwner = (doc) => { const s = getSection(doc, 'massing'); return s && s.tool === 'midrise' ? 'midrise' : 'tower'; };
  const neighborMaterial = (ctx) => {
    const st = siteStyleNow(ctx);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    if (st === 'glass') { m.transparent = true; m.opacity = 0.25; m.depthWrite = false; }
    if (st === 'wireframe') { m.colorWrite = false; m.depthWrite = false; }
    return { material: m, castShadow: st === 'solid', receiveShadow: st !== 'wireframe', edgeOpacity: st === 'glass' ? 0.85 : 0.6, renderOrder: st === 'glass' ? 2 : 0 };
  };

  const gradingSolids = solidDef({ id: 'grading', label: 'Grading', order: 40, owner: 'grading', layerIds: ['grading'], sections: ['grading', 'site'], defaultOn: DEFAULT_ON.grading === true, extraKey: () => groundTag() });
  const gradingDef = {
    ...gradingSolids,
    owner: 'grading',
    build(ctx) {
      const doc = docNow(ctx);
      const walls = gradingSolids.build(ctx);
      const a = all(doc);
      const gItem = a && a.grading && a.grading.ok ? a.grading.items.find((i) => i.kind === 'ground') : null;
      const extra = gItem ? gradingGroundObjects(doc, ctx, gItem) : [];
      if (!walls && !extra.length) return null;
      const g = walls || new THREE.Group();
      for (const o of extra) g.add(o);
      g.userData.count = (walls ? walls.userData.count : 0) + (extra.length ? 1 : 0);
      return g;
    },
    /** Every sync: own the ground override while the layer shows a proposed ground, unless a live tool holds it. */
    always(ctx, { on, replaced }) {
      if (!ground) return;
      const doc = docNow(ctx);
      const grid = doc ? gradingGrid(doc) : null;
      const want = on && !replaced && !!grid;
      const holder = ground.owner ? ground.owner() : null;
      if (want && (holder === null || holder === OVERRIDE_OWNER)) ground.setOverride(gradMemo.fn, OVERRIDE_OWNER);
      else if (!want && holder === OVERRIDE_OWNER) ground.setOverride(null, OVERRIDE_OWNER);
    },
    dispose(obj) { SiteLayer3D.dispose(obj.children.filter((o) => o.userData && o.userData.ownMaterials)); },
  };

  return [
    siteDef({ id: 'site-ground', label: 'Site ground', order: 10, parts: ['ground', 'boundary'] }),
    solidDef({ id: 'site-neighbors', label: 'Neighbors', order: 11, owner: 'site', layerIds: ['site'], sections: ['site'], defaultOn: DEFAULT_ON.site !== false, extraKey: (ctx) => siteStyleNow(ctx), materialFor: neighborMaterial }),
    siteDef({ id: 'site-roads', label: 'Roads', order: 12, parts: ['roads', 'walks'] }),
    siteDef({ id: 'site-water', label: 'Water', order: 13, parts: ['water'] }),
    // a wrap or podium deck takes the place of the massing levels it uses (core/cover.js)
    solidDef({ id: 'massing', label: 'Massing', order: 20, owner: massingOwner, layerIds: ['massing'], sections: ['massing', 'plates', 'parking'], defaultOn: DEFAULT_ON.massing !== false, extraKey: (ctx) => massingOwner(docNow(ctx)) + coverKey(docNow(ctx)),
      keep: (doc) => { const skip = coveredMassingIndices(doc); return skip.size ? (it) => !skip.has(it.level) : null; } }),
    solidDef({ id: 'units', label: 'Units', listed: false, order: 21, owner: 'plates', layerIds: ['units'], sections: ['plates', 'massing'], defaultOn: DEFAULT_ON.units !== false, hideWhen: platesStale, extraKey: (ctx) => (platesStale(ctx) ? 'stale' : '') }),
    solidDef({ id: 'cores', label: 'Cores and corridors', listed: false, order: 22, owner: 'plates', layerIds: ['cores'], sections: ['plates', 'massing'], defaultOn: DEFAULT_ON.cores !== false, hideWhen: platesStale, pickable: false, extraKey: (ctx) => (platesStale(ctx) ? 'stale' : '') }),
    solidDef({ id: 'parking', label: 'Parking', order: 30, owner: 'parking', layerIds: ['parking'], sections: ['parking', 'massing'], defaultOn: DEFAULT_ON.parking !== false }),
    gradingDef,
  ];
}
