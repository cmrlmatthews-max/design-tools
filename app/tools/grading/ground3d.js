/* ==========================================================================
   GRADING TOOL: ground3d
   Builds the three.js group of the live Grading layer from one derived result (port of build/grading/05c_ground3d.js).
     the proposed ground as one indexed mesh (the grid, refined 2x inside the work block) and a skirt,
     cut and fill colors in Diagram style (five steps each), the existing ground as a dashed wire where it differs,
     contours (proposed solid, existing dashed, majors heavier), the zero line, pad outlines and caps, one-story blocks on
     the tiers of typed buildings, walls (1 ft prisms from the low side to the top), routes (tubes colored per class),
     drive, lot and property outlines, slope conflict markers, and flat plan labels.
   Frame: everything is drawn in the SHELL scene frame: project point minus frame.getShift(), no vertical exaggeration,
   no base offset. World = [x, z, -y] (core/frame.js).
   Picking: the ground mesh has userData.isGround and userData.pick; walls, routes and blocks have userData.pick. Lines and
   labels have userData.occludes = false so they never block a pick.
   ========================================================================== */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { planMatrix } from '../../core/frame.js';
import { wallRecords } from '../../../src/grading/derived.js';
import { routeProfile } from '../../../src/grading/routes.js';
import { contours as contoursOf, zeroLine as zeroLineOf } from '../../../src/grading/contours.js';
import { CONFIG, fmt, polyLength } from './model.js';

const SKIRT = '#b9bfc6';
const AI_GROUND = '#f6f6f3';
const MIN_WALL_H = 0.1;
const col = (hex) => new THREE.Color(hex);

/** Color of a difference (proposed minus existing) on the cut and fill map: fill blue, cut red, five steps each. */
export function diffColor(diff) {
  const a = Math.abs(diff);
  if (a < CONFIG.noChange) return col(CONFIG.noChangeColor);
  let i = 0;
  while (i < CONFIG.diffEdges.length && a >= CONFIG.diffEdges[i]) i++;
  return col(diff > 0 ? CONFIG.fillColors[i] : CONFIG.cutColors[i]);
}

/**
 * o: { sh: {x,y,z}, style: 'model'|'diagram', cssColor(name, fb) -> THREE.Color, res: [w, h] (view size in CSS px),
 *      items: { ground() -> item, of(kind, id) -> item }, labels: bool }
 * Returns a THREE.Group. group.userData: { count, mats (LineMaterial list), ground (the ground mesh), baseColors }.
 */
export function buildLayer(D, state, o) {
  const sh = o.sh, diagram = o.style === 'diagram';
  const W = (x, y, e) => [x - sh.x, e - sh.z, -(y - sh.y)];
  const V = (x, y, e) => new THREE.Vector3(...W(x, y, e));
  const group = new THREE.Group();
  const mats = [];
  const add = (obj, tag) => { if (obj) { if (tag) obj.userData[tag] = true; group.add(obj); } return obj; };
  const modelC = o.cssColor('--scene-model', '#efefec');
  const edgeC = o.cssColor('--scene-edge', '#e7eaee');
  const b = D.built, g = b.grid;
  const at = b.surface.at;
  let count = 0;

  /* ---- fat lines (LineSegments2): width in CSS pixels ---- */
  function fat(pos, hex, width, opt = {}) {
    if (!pos.length) return null;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const op = opt.opacity == null ? 1 : opt.opacity;
    const mat = new LineMaterial({ color: col(hex).getHex(), linewidth: width, transparent: op < 1, opacity: op, depthWrite: false, depthTest: opt.depthTest !== false, dashed: !!opt.dashed, dashSize: opt.dash || 4, gapSize: opt.gap || 3 });
    mat.resolution.set(o.res[0], o.res[1]);
    mats.push(mat);
    const ls = new LineSegments2(geo, mat);
    if (opt.dashed) ls.computeLineDistances();
    ls.renderOrder = opt.order == null ? 5 : opt.order;
    ls.frustumCulled = false;
    ls.raycast = () => {};
    ls.userData.occludes = false;
    ls.userData.overlay = true;
    return ls;
  }
  const loopPos = (out, ring, z) => { for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; out.push(...W(a[0], a[1], z), ...W(c[0], c[1], z)); } };
  /** A ring or a line sampled every `step` ft, each point at the elevation zAt(x, y) + lift. */
  function drape(out, pts, closed, step, zAt, lift = 0.15) {
    const n = pts.length, last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i], c = pts[(i + 1) % n];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
      let q = null;
      for (let s = 0; s <= k; s++) {
        const f = s / k, x = a[0] + (c[0] - a[0]) * f, y = a[1] + (c[1] - a[1]) * f;
        const p = W(x, y, zAt(x, y) + lift);
        if (q) out.push(...q, ...p);
        q = p;
      }
    }
  }

  /* ---- flat plan labels (canvas text on a plane laid on the plan) ---- */
  function label(text, x, y, z, { height = 4.5, color = '#1d2733', halo = '#ffffff' } = {}) {
    try {
      const rows = String(text).split('\n');
      const px = 48, pad = 12;
      const cv = document.createElement('canvas');
      const c0 = cv.getContext('2d');
      c0.font = `600 ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const widest = Math.max(...rows.map((r) => c0.measureText(r).width));
      cv.width = Math.ceil(widest + pad * 2); cv.height = Math.ceil(rows.length * px * 1.2 + pad * 2);
      const c = cv.getContext('2d');
      c.font = `600 ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      rows.forEach((r, i) => {
        const yy = pad + px * 0.6 + i * px * 1.2;
        c.lineWidth = 9; c.strokeStyle = halo; c.strokeText(r, cv.width / 2, yy);
        c.fillStyle = color; c.fillText(r, cv.width / 2, yy);
      });
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const hh = height * rows.length * 1.2 + (height * 2 * pad) / px, ww = (hh * cv.width) / cv.height;
      const geo = new THREE.PlaneGeometry(ww, hh);
      geo.translate(x - sh.x, y - sh.y, 0);
      geo.applyMatrix4(planMatrix(z + 0.4 - sh.z));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.raycast = () => {};
      mesh.userData.occludes = false; mesh.userData.overlay = true; mesh.userData.plan = true; mesh.userData.label = String(text);
      mesh.visible = !!o.labels;
      return mesh;
    } catch (e) { return null; }
  }
  // Labels are flat text in feet: they grow with the framed work so they stay readable in plan.
  const labelUnit = (() => {
    const bx = D.box;
    const span = bx ? Math.max(bx.maxX - bx.minX, bx.maxY - bx.minY) : (g.n - 1) * g.spacing / 2;
    return Math.min(4, Math.max(1, span / 150));
  })();
  const labels = [];

  /* ---- the ground mesh and the skirt ---- */
  function groundObjects() {
    const n = g.n, sp = g.spacing, pz = D.proposedZ;
    const fine = D.fine, blk = fine ? fine.block : null, nf = fine ? fine.n : 0;
    const nv = n * n + nf * nf;
    const pos = new Float32Array(nv * 3), colr = new Float32Array(nv * 3);
    const put = (k, x, y, z, e) => {
      pos[3 * k] = x - sh.x; pos[3 * k + 1] = z - sh.z; pos[3 * k + 2] = -(y - sh.y);
      const c = diagram ? diffColor(z - e) : modelC;
      colr[3 * k] = c.r; colr[3 * k + 1] = c.g; colr[3 * k + 2] = c.b;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(j * n + i, g.x0 + i * sp, g.y0 + j * sp, pz[j * n + i], g.z[j * n + i]);
    if (fine) for (let jb = 0; jb < nf; jb++) for (let ia = 0; ia < nf; ia++) {
      const x = fine.x0 + ia * fine.spacing, y = fine.y0 + jb * fine.spacing;
      put(n * n + jb * nf + ia, x, y, fine.z[jb * nf + ia], b.existingAt(x, y));
    }
    const idx = [];
    const inBlock = (i, j) => !!blk && i >= blk.i0 && i < blk.i0 + blk.m && j >= blk.j0 && j < blk.j0 + blk.m;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      if (inBlock(i, j)) continue;
      const a = j * n + i, bb = a + 1, c = a + n + 1, d = a + n;
      idx.push(a, bb, c, a, c, d);
    }
    if (fine) for (let jb = 0; jb < nf - 1; jb++) for (let ia = 0; ia < nf - 1; ia++) {
      const a = n * n + jb * nf + ia, bb = a + 1, c = a + nf + 1, d = a + nf;
      idx.push(a, bb, c, a, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 1.5 }));
    mesh.userData.model = true; mesh.userData.isGround = true; mesh.userData.ground = true;
    mesh.userData.baseColors = colr.slice();
    mesh.userData.pick = () => o.items.ground();
    mesh.receiveShadow = true; mesh.castShadow = true;
    group.userData.ground = mesh;
    add(mesh);

    // skirt: the four sides down to 4 ft under the lowest ground
    let low = Infinity;
    for (let k = 0; k < pz.length; k++) low = Math.min(low, pz[k], g.z[k]);
    const floorY = (Number.isFinite(low) ? low : 0) - 4 - sh.z;
    const sk = [], skc = [], sc = col(SKIRT);
    const top = (i, j) => pz[j * n + i] - sh.z;
    const quad = (x0, y0, t0, x1, y1, t1) => {
      const ax = x0 - sh.x, ay = -(y0 - sh.y), bx = x1 - sh.x, by = -(y1 - sh.y);
      sk.push(ax, t0, ay, bx, t1, by, bx, floorY, by, ax, t0, ay, bx, floorY, by, ax, floorY, ay);
      for (let q = 0; q < 6; q++) skc.push(sc.r, sc.g, sc.b);
    };
    for (let i = 0; i < n - 1; i++) {
      quad(g.x0 + i * sp, g.y0, top(i, 0), g.x0 + (i + 1) * sp, g.y0, top(i + 1, 0));
      quad(g.x0 + i * sp, g.y0 + (n - 1) * sp, top(i, n - 1), g.x0 + (i + 1) * sp, g.y0 + (n - 1) * sp, top(i + 1, n - 1));
      quad(g.x0, g.y0 + i * sp, top(0, i), g.x0, g.y0 + (i + 1) * sp, top(0, i + 1));
      quad(g.x0 + (n - 1) * sp, g.y0 + i * sp, top(n - 1, i), g.x0 + (n - 1) * sp, g.y0 + (i + 1) * sp, top(n - 1, i + 1));
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3));
    sgeo.setAttribute('color', new THREE.Float32BufferAttribute(skc, 3));
    sgeo.computeVertexNormals();
    const skirt = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    skirt.userData.model = true; skirt.userData.skirt = true;
    skirt.userData.pick = () => o.items.ground();
    add(skirt);
  }

  /** The existing ground as a dashed wire where it differs from the proposed ground. */
  function existingWire() {
    const n = g.n, sp = g.spacing, pz = D.proposedZ, ez = g.z;
    const pos = [];
    const changed = (i, j) => {
      for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const k = (j + dj) * n + i + di; if (Math.abs(pz[k] - ez[k]) > 0.05) return true; }
      return false;
    };
    const P = (i, j) => W(g.x0 + i * sp, g.y0 + j * sp, ez[j * n + i]);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      if (!changed(i, j)) continue;
      pos.push(...P(i, j), ...P(i + 1, j), ...P(i, j), ...P(i, j + 1));
      if (i === n - 2 || !changed(i + 1, j)) pos.push(...P(i + 1, j), ...P(i + 1, j + 1));
      if (j === n - 2 || !changed(i, j + 1)) pos.push(...P(i, j + 1), ...P(i + 1, j + 1));
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: col(CONFIG.existingColor), dashSize: 3, gapSize: 2, transparent: true, opacity: 0.7, depthWrite: false }));
    ls.computeLineDistances();
    ls.renderOrder = 3; ls.frustumCulled = false; ls.userData.wire = true; ls.userData.overlay = true; ls.raycast = () => {};
    add(ls);
  }

  /* ---- contours and the zero line ---- */
  const inRect = (x, y, r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && y >= r.y0 - 1e-6 && y <= r.y1 + 1e-6;
  function contourSegs(lines, rect, lift, keep) {
    const out = [];
    for (const L of lines) {
      if (!keep(L)) continue;
      for (let i = 0; i + 1 < L.line.length; i++) {
        const a = L.line[i], c = L.line[i + 1];
        if (rect && inRect((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, rect)) continue;
        out.push(...W(a[0], a[1], L.z + lift), ...W(c[0], c[1], L.z + lift));
      }
    }
    return out;
  }
  const safeContours = (grid, values, interval) => { try { return contoursOf(grid, values, interval, { majorEvery: 5 }); } catch (e) { return []; } };
  function contourObjects() {
    const ci = state.view.contours;
    const n = g.n, sp = g.spacing;
    const gridLike = { spacing: sp, n, x0: g.x0, y0: g.y0 };
    const fine = D.fine;
    const fineLike = fine ? { spacing: fine.spacing, n: fine.n, x0: fine.x0, y0: fine.y0 } : null;
    const rect = fine ? { x0: fine.x0, y0: fine.y0, x1: fine.x0 + (fine.n - 1) * fine.spacing, y1: fine.y0 + (fine.n - 1) * fine.spacing } : null;
    const lift = 0.06, interval = ci.interval === 2 ? 2 : 1;
    if (ci.on && ci.proposed) {
      const coarse = safeContours(gridLike, D.proposedZ, interval), fineL = fine ? safeContours(fineLike, fine.z, interval) : [];
      const mk = (major) => contourSegs(coarse, rect, lift, (L) => L.major === major).concat(contourSegs(fineL, null, lift, (L) => L.major === major));
      const minor = add(fat(mk(false), '#c5ccd4', 1, { opacity: 0.5, order: 4 }));
      const major = add(fat(mk(true), '#eef1f4', 1.5, { opacity: 0.9, order: 4 }));
      if (minor) minor.userData.contour = 'proposed';
      if (major) major.userData.contour = 'proposed';
      const best = new Map();
      for (const L of coarse.concat(fineL)) {
        if (!L.major) continue;
        const l = polyLength(L.line);
        if (l > 70 && (!best.has(L.z) || best.get(L.z).l < l)) best.set(L.z, { l, L });
      }
      for (const { L } of [...best.values()].sort((a, c) => c.l - a.l).slice(0, 14)) {
        const mid = L.line[Math.floor(L.line.length / 2)];
        labels.push({ text: Math.round(L.z).toLocaleString('en-US'), x: mid[0], y: mid[1], z: L.z, color: '#1d242b', height: 3.2, small: true });
      }
    }
    if (ci.on && ci.existing) {
      const lines = safeContours(gridLike, g.z, interval);
      const dashed = add(fat(contourSegs(lines, null, lift, () => true), CONFIG.existingColor, 1, { dashed: true, dash: 3, gap: 2.5, opacity: 0.9, order: 3 }));
      if (dashed) dashed.userData.contour = 'existing';
    }
    if (diagram) {
      const diff = new Float64Array(n * n);
      for (let k = 0; k < n * n; k++) diff[k] = D.proposedZ[k] - g.z[k];
      let zl = [];
      try { zl = zeroLineOf(gridLike, diff); } catch (e) { zl = []; }
      const pos = [];
      const addLine = (line, clip) => {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], c = line[i + 1];
          if (clip && rect && inRect((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, rect)) continue;
          pos.push(...W(a[0], a[1], at(a[0], a[1]) + 0.2), ...W(c[0], c[1], at(c[0], c[1]) + 0.2));
        }
      };
      for (const line of zl) addLine(line, true);
      if (fine) {
        const fd = new Float64Array(fine.n * fine.n);
        for (let jb = 0; jb < fine.n; jb++) for (let ia = 0; ia < fine.n; ia++) fd[jb * fine.n + ia] = fine.z[jb * fine.n + ia] - b.existingAt(fine.x0 + ia * fine.spacing, fine.y0 + jb * fine.spacing);
        let zf = [];
        try { zf = zeroLineOf(fineLike, fd); } catch (e) { zf = []; }
        for (const line of zf) addLine(line, false);
      }
      const z = add(fat(pos, '#1d242b', 2, { order: 6 }));
      if (z) z.userData.zeroLine = true;
    }
  }

  /* ---- pads and the one-story blocks of typed buildings ---- */
  function padObjects() {
    const pos = [];
    const typed = new Set((b.buildings || []).filter((x) => x.source === 'typed').map((x) => x.id));
    const blockMat = new THREE.MeshStandardMaterial({ color: modelC, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const capMat = new THREE.MeshStandardMaterial({ color: modelC, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const edgeMat = new THREE.LineBasicMaterial({ color: edgeC, transparent: true, opacity: 0.55 });
    for (const t of b.tiers) {
      const item = o.items.of('building', t.building);
      for (const ring of t.pads || []) {
        loopPos(pos, ring, t.padTop + 0.1);
        if (!diagram) {
          try {
            const shape = new THREE.Shape(ring.map((q) => new THREE.Vector2(q[0] - sh.x, q[1] - sh.y)));
            const geo = new THREE.ShapeGeometry(shape);
            geo.deleteAttribute('uv');
            geo.applyMatrix4(planMatrix(t.padTop - sh.z + 0.03));
            const m = new THREE.Mesh(geo, capMat);
            m.userData.model = true; m.userData.padCap = t.id; m.userData.pick = () => item; m.receiveShadow = true;
            add(m);
          } catch (e) { /* a degenerate ring draws no cap */ }
        }
      }
      if (typed.has(t.building)) {
        for (const ring of t.outers || (t.outer && t.outer.length ? [t.outer] : [])) {
          try {
            const shape = new THREE.Shape(ring.map((q) => new THREE.Vector2(q[0] - sh.x, q[1] - sh.y)));
            const depth = Math.max(0.2, t.ffe - t.padTop + CONFIG.buildingHeight);
            const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
            geo.deleteAttribute('uv');
            geo.applyMatrix4(planMatrix(t.padTop - sh.z));
            const mesh = new THREE.Mesh(geo, blockMat);
            mesh.userData.model = true; mesh.userData.block = t.id; mesh.userData.pick = () => item;
            mesh.castShadow = true; mesh.receiveShadow = true;
            add(mesh);
            const eg = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
            eg.userData.edges = true; eg.renderOrder = 2; eg.raycast = () => {};
            add(eg);
          } catch (e) { /* skip a bad ring */ }
        }
      }
      const ring = t.pad && t.pad.length ? t.pad : t.outer;
      if (ring && ring.length >= 3) {
        const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        labels.push({ text: `FFE ${fmt.elev(t.ffe)}`, x: c[0], y: c[1], z: t.ffe + (typed.has(t.building) ? CONFIG.buildingHeight : 0) + 0.5, color: '#16427a', height: 4.5 });
      }
      count++;
    }
    add(fat(pos, CONFIG.padColor, 2, { order: 6 }), 'pads');
  }

  /* ---- walls ---- */
  function wallGeometry(rec) {
    const s = rec.profile.samples, line = rec.line;
    const pos = [];
    const addQuad = (a, c, d, e) => pos.push(...a, ...c, ...d, ...a, ...d, ...e);
    const bySeg = new Map();
    s.forEach((p, i) => { if (!bySeg.has(p.seg)) bySeg.set(p.seg, []); bySeg.get(p.seg).push(i); });
    let prev = -1;
    for (const seg of [...bySeg.keys()].sort((a, c) => a - c)) {
      const idx = bySeg.get(seg).slice();
      if (prev >= 0) idx.unshift(prev);
      prev = idx[idx.length - 1];
      const a = line[seg], c = line[seg + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (!(L > 0) || idx.length < 2) continue;
      const tx = (c[0] - a[0]) / L, ty = (c[1] - a[1]) / L, nx = -ty, ny = tx, hw = 0.5;
      const sec = idx.map((i) => {
        const p = s[i], topE = p.top, bot = Math.min(p.bottom, p.top - 0.2);
        const l = (e) => W(p.x + nx * hw, p.y + ny * hw, e), r = (e) => W(p.x - nx * hw, p.y - ny * hw, e);
        return { lb: l(bot), rb: r(bot), rt: r(topE), lt: l(topE) };
      });
      for (let k = 0; k + 1 < sec.length; k++) {
        const A = sec[k], B = sec[k + 1];
        addQuad(A.lb, B.lb, B.rb, A.rb);
        addQuad(A.lt, A.rt, B.rt, B.lt);
        addQuad(A.lb, A.lt, B.lt, B.lb);
        addQuad(A.rb, B.rb, B.rt, A.rt);
      }
      const S = sec[0], E = sec[sec.length - 1];
      addQuad(S.lb, S.rb, S.rt, S.lt);
      addQuad(E.lb, E.lt, E.rt, E.rb);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }
  function wallObjects() {
    let recs = [];
    try { recs = wallRecords(state, b); } catch (e) { console.error(e); }
    const flag = state.limits.wallFlag;
    const cache = {};
    const matOf = (key, hex, extra = {}) => cache[key] || (cache[key] = new THREE.MeshStandardMaterial({ color: col(hex), roughness: 0.9, side: THREE.DoubleSide, ...extra }));
    for (const rec of recs) {
      if (rec.heightMax < MIN_WALL_H || rec.profile.samples.length < 2) continue;
      const flagged = rec.heightMax > flag + 1e-9;
      const loose = rec.auto && !rec.accepted;
      let m;
      if (loose) m = matOf('loose', CONFIG.wallColor, { transparent: true, opacity: 0.4, depthWrite: false });
      else if (flagged) m = matOf('flag', CONFIG.wallFlagColor);
      else if (rec.kind === 'pad-step') m = matOf('step', CONFIG.wallStepColor);
      else m = matOf('wall', CONFIG.wallColor);
      const mesh = new THREE.Mesh(wallGeometry(rec), m);
      const item = o.items.of('wall', rec.id);
      mesh.userData.model = true; mesh.userData.wallKind = rec.kind; mesh.userData.pick = () => item;
      mesh.castShadow = !loose; mesh.receiveShadow = true;
      add(mesh);
      const pos = [];
      const tl = rec.top;
      for (let i = 0; i + 1 < tl.length; i++) pos.push(...W(tl[i][0], tl[i][1], tl[i][2] + 0.05), ...W(tl[i + 1][0], tl[i + 1][1], tl[i + 1][2] + 0.05));
      const ln = add(fat(pos, flagged ? CONFIG.wallFlagColor : '#2a3139', 2, { dashed: loose, dash: 3, gap: 2, order: 6 }));
      if (ln) ln.userData.wallTop = rec.id;
      const im = rec.profile.samples[rec.profile.iMax];
      if (im && rec.heightMax >= 0.5) labels.push({ text: `${rec.heightMax.toFixed(1)} ft`, x: im.x, y: im.y, z: im.top, color: flagged ? '#b24a0a' : '#1d2733', height: 4.5 });
      count++;
    }
  }

  /* ---- routes ---- */
  function routeObjects() {
    for (const r of state.routes) {
      if (!r.line || r.line.length < 2) continue;
      let prof;
      try { prof = routeProfile(r, at, state.limits); } catch (e) { continue; }
      const S = prof.samples;
      if (S.length < 2) continue;
      const item = o.items.of('route', r.id);
      let i = 0;
      while (i < S.length - 1) {
        const cls = S[i].cls;
        let j = i + 1;
        while (j < S.length - 1 && S[j].cls === cls) j++;
        const pts = S.slice(i, j + 1).map((p) => V(p.x, p.y, p.z + 0.7));
        if (pts.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
          const geo = new THREE.TubeGeometry(curve, Math.max(2, pts.length), 0.55, 6, false);
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(CONFIG.classColors[cls] || CONFIG.classColors.walk), roughness: 0.6 }));
          mesh.userData.route = r.id; mesh.userData.pick = () => item; mesh.renderOrder = 7;
          add(mesh);
        }
        i = j;
      }
      for (const p of [S[0], S[S.length - 1]]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshStandardMaterial({ color: col('#1d2733'), roughness: 0.7 }));
        dot.position.copy(V(p.x, p.y, p.z + 0.7)); dot.renderOrder = 7; dot.userData.pick = () => item;
        add(dot);
      }
      const mid = S[Math.floor(S.length / 2)];
      labels.push({ text: `${r.name}\n${(prof.maxSlope * 100).toFixed(1)}% max`, x: mid.x, y: mid.y, z: mid.z + 1.2, color: prof.kind === 'walk' ? '#1f7a44' : '#8a5a00', height: 4.5 });
      count++;
    }
  }

  /* ---- drives, lots, property line, conflicts ---- */
  function outlineObjects() {
    const driveP = [], lotP = [], centerP = [];
    for (const f of b.features) {
      if (f.kind === 'drive') drape(driveP, f.ring, true, 4, (x, y) => at(x, y), 0.2);
      if (f.kind === 'lot') drape(lotP, f.ring, true, 4, (x, y) => at(x, y), 0.2);
    }
    for (const dv of state.drives) if (dv.line && dv.line.length >= 2) drape(centerP, dv.line, false, 4, (x, y) => at(x, y), 0.25);
    add(fat(driveP, CONFIG.driveColor, 2, { order: 6 }), 'drives');
    add(fat(centerP, CONFIG.driveColor, 1, { dashed: true, dash: 5, gap: 4, order: 6 }), 'drives');
    add(fat(lotP, CONFIG.lotColor, 2, { dashed: true, dash: 6, gap: 3, order: 6 }), 'lots');
    count += state.drives.length + state.lots.length;
    const prop = b.property;
    if (prop && prop.length >= 3 && state.property.mode === 'drawn') {
      const pp = [];
      drape(pp, prop, true, 8, (x, y) => at(x, y), 0.3);
      add(fat(pp, CONFIG.propertyColor, 2, { dashed: true, dash: 8, gap: 4, order: 6 }), 'property');
    }
    for (const c2 of b.conflicts || []) {
      const z0 = at(c2.x, c2.y);
      const p0 = V(c2.x, c2.y, z0), p1 = V(c2.x, c2.y, z0 + 25);
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, p1]), new THREE.LineBasicMaterial({ color: col(CONFIG.conflictColor), depthWrite: false }));
      ln.userData.conflict = true; ln.userData.overlay = true; ln.renderOrder = 8; ln.raycast = () => {};
      add(ln);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 12), new THREE.MeshStandardMaterial({ color: col(CONFIG.conflictColor), roughness: 0.6 }));
      cone.position.copy(p1); cone.rotation.x = Math.PI; cone.renderOrder = 8;
      cone.userData.occludes = false; cone.userData.overlay = true; cone.raycast = () => {};
      add(cone);
    }
  }

  try { groundObjects(); } catch (e) { console.error(e); }
  try { existingWire(); } catch (e) { console.error(e); }
  try { contourObjects(); } catch (e) { console.error(e); }
  try { padObjects(); } catch (e) { console.error(e); }
  try { wallObjects(); } catch (e) { console.error(e); }
  try { routeObjects(); } catch (e) { console.error(e); }
  try { outlineObjects(); } catch (e) { console.error(e); }
  for (const L of labels) add(label(L.text, L.x, L.y, L.z, { height: (L.height || 4.5) * labelUnit, color: L.color }));
  group.userData.mats = mats;
  group.userData.count = Math.max(1, count);
  return group;
}

/** AI-ready: the ground goes plain light, the lines, labels and markers hide. Repaints in place. */
export function setAiReady(group, on) {
  if (!group) return;
  group.traverse((o) => {
    if (o.userData && o.userData.overlay) {
      if (on) { if (o.userData.visWas === undefined) o.userData.visWas = o.visible; o.visible = false; }
      else if (o.userData.visWas !== undefined) { o.visible = o.userData.visWas; delete o.userData.visWas; }
    }
    if (o.userData && o.userData.baseColors && o.geometry) {
      const col2 = o.geometry.getAttribute('color'), c = new THREE.Color(AI_GROUND);
      if (on) { for (let k = 0; k < col2.count; k++) col2.setXYZ(k, c.r, c.g, c.b); }
      else col2.array.set(o.userData.baseColors);
      col2.needsUpdate = true;
    }
  });
}

/** Plan labels show in the Plan view and in Diagram style. */
export function setLabelsVisible(group, on) {
  if (!group) return;
  group.traverse((o) => { if (o.userData && o.userData.plan && o.userData.visWas === undefined) o.visible = !!on; });
}

/** Frees the label textures (the shell frees geometry and materials). */
export function disposeExtras(group) {
  if (!group) return;
  group.traverse((o) => { const m = o.material; if (m && m.map && m.map.dispose) m.map.dispose(); });
}
