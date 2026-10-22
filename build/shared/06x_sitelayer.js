/* ==========================================================================
   SITE LAYER 3D  (docs/site-layer-technical-plan.md sections 4 and 5)
   `SiteLayer3D` turns the data of SiteLayerMod.buildSiteLayerData (plain arrays in a tool's local frame, z relative to the
   tool's base) into Three.js objects: the ground with elevation shading and a skirt, the draped boundary with its north arrow,
   the neighbor buildings (solid, with dark edges), roads, walks, water and trees. One merged BufferGeometry per kind.
   Same look as the Site Model scene (build/site/03_scene.js).

   Shared by every tool. Page globals used (at call time only): THREE, BufferGeometryUtils, planToWorld, planMatrix, worldVec.
   The tool's own 06c_site.js (SiteLayer) decides when to build and calls objects() inside kit.syncLayer.

   Everything draped on the ground (roads, walks, trees, the boundary arrow) samples the drawn ground MESH (the same two
   triangles per cell as the ground geometry), so nothing floats or sinks. Without a ground the sampler gives 0.
   ========================================================================== */
const SiteLayer3D = (() => {
  const ALL_PARTS = ['ground', 'boundary', 'buildings', 'roads', 'walks', 'water', 'trees'];
  const EDGE_ANGLE = 30;
  const BOUNDARY_COLOR = 0xc0701a;       // the Tower's dashed site loop
  const ARROW_COLOR = 0x1d2733;

  /* ---- colors from the CSS tokens (light value, dark value when the page has no token yet) ---- */
  const FALLBACK = {
    '--scene-terrain-lo': ['#d6dadd', '#3a4047'], '--scene-terrain-hi': ['#eceeef', '#4a5159'], '--scene-skirt': ['#bcc2c8', '#2a2f35'],
    '--scene-est': ['#efe2cf', '#dccaa9'], '--scene-road': ['#9ba1a8', '#656c74'], '--scene-walk': ['#c6cacd', '#858d95'],
    '--scene-water': ['#8dbbe3', '#3f72a6'], '--scene-tree': ['#8fa88b', '#6e8d6c'], '--scene-trunk': ['#8a8378', '#8a8378'],
    '--scene-model': ['#f6f6f3', '#efefec'], '--scene-edge': ['#20262d', '#e7eaee'],
  };
  const isDark = () => { try { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; } };
  function defaultCss(name, fallback) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { v = ''; }
    const fb = fallback || (FALLBACK[name] ? FALLBACK[name][isDark() ? 1 : 0] : '#888888');
    try { return new THREE.Color(v || fb); } catch (e) { return new THREE.Color(fb); }
  }

  /* ---- the drawn ground surface: elevation at a local point (relative z) ---- */
  /** Sampler over data.ground. The grid may be rotated (a rotated placement turns the mesh as a solid), so the query point is
   *  projected on the two grid axes. Same triangles as the mesh: cell split a-b-c / a-c-d, u >= v. null without a ground. */
  function makeSampler(g) {
    if (!g || !g.positions || !(g.n >= 2)) return null;
    const P = g.positions, n = g.n, d = g.spacing;
    const x0 = P[0], y0 = P[1];
    let e1x = (P[3] - x0) / d, e1y = (P[4] - y0) / d;
    let e2x = (P[3 * n] - x0) / d, e2y = (P[3 * n + 1] - y0) / d;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    const L = n - 1;
    return (x, y) => {
      const dx = x - x0, dy = y - y0;
      const cu = Math.min(L, Math.max(0, (dx * e1x + dy * e1y) / d)), cv = Math.min(L, Math.max(0, (dx * e2x + dy * e2y) / d));
      const i = Math.min(Math.floor(cu), n - 2), j = Math.min(Math.floor(cv), n - 2);
      const u = cu - i, v = cv - j, o = j * n + i;
      const za = P[3 * o + 2], zb = P[3 * (o + 1) + 2], zc = P[3 * (o + n + 1) + 2], zd = P[3 * (o + n) + 2];
      return u >= v ? za + u * (zb - za) + v * (zc - zb) : za + u * (zc - zd) + v * (zd - za);
    };
  }

  /* ---- helpers ---- */
  /** Maps the y (elevation) of a world-space geometry through zOf. Only for a non-identity zOf. */
  function mapElevation(geo, zOf) {
    if (!zOf) return geo;
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, zOf(p.getY(i)));
    p.needsUpdate = true;
    return geo;
  }
  function densifyRing(ring, step) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      out.push(a);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.ceil(L / step);
      for (let s = 1; s < k; s++) out.push([a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k]);
    }
    return out;
  }
  /** Drops a repeated closing point (ShapeUtils would drop it and shift the hole indices). */
  function trimRing(r) {
    const o = r.slice();
    while (o.length > 1 && o[0][0] === o[o.length - 1][0] && o[0][1] === o[o.length - 1][1]) o.pop();
    return o;
  }
  /** polys: [{ outer, holes }]. elevOf(x, y) gives the local elevation, zOf maps it to world y. Returns a BufferGeometry or null. */
  function polyGeometry(polys, elevOf, zOf, step) {
    const pos = [], idx = [];
    for (const p of polys) {
      try {
        const outer = step ? densifyRing(trimRing(p.outer), step) : trimRing(p.outer);
        const holes = (p.holes || []).map((hh) => (step ? densifyRing(trimRing(hh), step) : trimRing(hh)));
        const tris = THREE.ShapeUtils.triangulateShape(outer.map((q) => new THREE.Vector2(q[0], q[1])), holes.map((hh) => hh.map((q) => new THREE.Vector2(q[0], q[1]))));
        const all = outer.concat(...holes), base = pos.length / 3;
        for (const q of all) pos.push(q[0], zOf(elevOf(q[0], q[1])), -q[1]);
        for (const [a, b, c] of tris) {
          const ax = all[a][0], ay = all[a][1], bx = all[b][0], by = all[b][1], cx = all[c][0], cy = all[c][1];
          const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;      // plan CCW = facing up
          if (ccw) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
        }
      } catch (e) { console.warn('site polygon skipped', e); }
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }
  const mergeAll = (list) => {
    if (list.length === 1) return list[0];
    const merged = BufferGeometryUtils.mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    return merged;
  };

  /* ---- the parts ---- */
  function buildGround(data, o, mats, out, info) {
    const g = data.ground;
    if (!g) return;
    const n = g.n, N = n * n, P = g.positions;
    const lo = o.css('--scene-terrain-lo'), hi = o.css('--scene-terrain-hi'), c = new THREE.Color();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      pos[3 * k] = P[3 * k]; pos[3 * k + 1] = o.zOf(P[3 * k + 2]); pos[3 * k + 2] = -P[3 * k + 1];
      c.copy(lo).lerp(hi, g.shade[k]);
      col[3 * k] = c.r; col[3 * k + 1] = c.g; col[3 * k + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.kind = 'site-ground';
    mesh.userData.site = true;
    mesh.userData.receives = true;
    out.push(mesh);
    info.triangles += g.indices.length / 3;

    // skirt: a thin plate under the ground, the site reads as a physical model
    const sk = g.skirt;
    if (sk && sk.positions && sk.indices) {
      const sp = new Float32Array(sk.positions.length);
      for (let k = 0; k < sk.positions.length; k += 3) { sp[k] = sk.positions[k]; sp[k + 1] = o.zOf(sk.positions[k + 2]); sp[k + 2] = -sk.positions[k + 1]; }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      sg.setIndex(new THREE.BufferAttribute(sk.indices, 1));
      sg.computeVertexNormals();
      const smat = new THREE.MeshStandardMaterial({ color: o.css('--scene-skirt'), roughness: 1, metalness: 0 });
      mats.push(smat);
      const skirt = new THREE.Mesh(sg, smat);
      skirt.userData.kind = 'site-skirt';
      skirt.userData.site = true;
      out.push(skirt);
      info.triangles += sk.indices.length / 3;
    }
  }

  /** The dashed site loop, just above the ground, and the north arrow beside its north-east corner (turns with the placement). */
  function buildBoundary(data, o, mats, out, zAt) {
    const ring = data.boundary;
    if (!ring || ring.length < 3) return;
    const dashed = new THREE.LineDashedMaterial({ color: BOUNDARY_COLOR, dashSize: 12, gapSize: 8 });
    const solid = new THREE.LineBasicMaterial({ color: ARROW_COLOR });
    mats.push(dashed, solid);
    const loop = new THREE.BufferGeometry().setFromPoints(ring.map((q) => worldVec(q[0], q[1], o.zOf(q[2]))));
    const line = new THREE.LineLoop(loop, dashed);
    line.computeLineDistances();
    line.userData.kind = 'site-boundary';
    out.push(line);

    // north arrow: project north in the local frame is (sin r, cos r); a shaft, a head and an N, flat on the ground
    const r = ((o.rotation || 0) * Math.PI) / 180, nx = Math.sin(r), ny = Math.cos(r), ex = ny, ey = -nx;     // north and east unit vectors
    let maxX = -Infinity, maxY = -Infinity, minX = Infinity, minY = Infinity;
    for (const q of ring) { maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]); minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const k = Math.max(0.5, Math.min(4, span / 1000));                                         // scales with the site, 1 at 1,000 ft
    let best = null;                                                                           // the boundary corner farthest toward north-east
    for (const q of ring) { const s = q[0] * (ex + nx) + q[1] * (ey + ny); if (!best || s > best.s) best = { s, q }; }
    const base = [best.q[0] + (ex - nx) * 30 * k, best.q[1] + (ey - ny) * 30 * k];
    const P = (a, b) => [base[0] + ex * a * k + nx * b * k, base[1] + ey * a * k + ny * b * k];   // a = east, b = north
    const pts = [];
    const seg = (p, q) => { pts.push(worldVec(p[0], p[1], o.zOf(zAt(p[0], p[1]) + 0.3)), worldVec(q[0], q[1], o.zOf(zAt(q[0], q[1]) + 0.3))); };
    // each stroke is cut into short pieces so it follows a sloping ground
    const stroke = (p, q) => { const m = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (6 * k))); for (let s = 0; s < m; s++) seg([p[0] + (q[0] - p[0]) * s / m, p[1] + (q[1] - p[1]) * s / m], [p[0] + (q[0] - p[0]) * (s + 1) / m, p[1] + (q[1] - p[1]) * (s + 1) / m]); };
    stroke(P(0, 0), P(0, 40)); stroke(P(0, 40), P(-7, 26)); stroke(P(0, 40), P(7, 26));
    stroke(P(-6, 50), P(-6, 68)); stroke(P(-6, 68), P(6, 50)); stroke(P(6, 50), P(6, 68));      // the letter N
    const arrow = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), solid);
    arrow.userData.kind = 'site-arrow';
    out.push(arrow);
  }

  function buildBuildings(data, o, mats, out, info) {
    const plain = [], est = [];
    let count = 0;
    for (const b of data.buildings || []) {
      try {
        if (!b.outer || b.outer.length < 3) continue;
        const shape = new THREE.Shape(b.outer.map((q) => new THREE.Vector2(q[0], q[1])));
        for (const hole of b.holes || []) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((q) => new THREE.Vector2(q[0], q[1]))));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.1, b.height) + 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
        geo.deleteAttribute('uv');
        geo.applyMatrix4(planMatrix(b.base - 1));
        mapElevation(geo, o.identity ? null : o.zOf);
        (b.rule === 'estimate' ? est : plain).push(geo);
        count++;
      } catch (e) { console.warn('site building skipped', b && b.id, e); }
    }
    for (const [list, color] of [[plain, o.css('--scene-model')], [est, o.css('--scene-est')]]) {
      if (!list.length) continue;
      const merged = mergeAll(list);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0 });
      mats.push(mat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.userData.kind = 'site-buildings';
      mesh.userData.site = true;
      mesh.userData.casts = true; mesh.userData.receives = true;
      out.push(mesh);
      info.triangles += (merged.index ? merged.index.count : merged.getAttribute('position').count) / 3;
      if (o.edges) {
        const emat = new THREE.LineBasicMaterial({ color: o.css('--scene-edge') });
        mats.push(emat);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, EDGE_ANGLE), emat);
        edges.userData.kind = 'site-building-edges';
        edges.userData.site = true;
        out.push(edges);
      }
    }
    info.buildings = count;
  }

  function buildPavement(polys, colorName, lift, factor, kind, o, mats, out, info, zAt) {
    if (!polys || !polys.length) return;
    const geo = polyGeometry(polys, (x, y) => zAt(x, y) + lift, o.zOf, 10);
    if (!geo) return;
    const mat = new THREE.MeshStandardMaterial({ color: o.css(colorName), roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor });
    mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.kind = kind;
    mesh.userData.site = true;
    mesh.userData.receives = true;
    out.push(mesh);
    info.triangles += geo.index.count / 3;
    info[kind === 'site-roads' ? 'roads' : 'walks'] = polys.length;
  }

  function buildWater(data, o, mats, out, info) {
    const w = data.water || {};
    const geos = [];
    for (const a of w.areas || []) {
      const g = polyGeometry([a], () => a.level, o.zOf, 0);
      if (g) geos.push(g);
    }
    info.waterAreas = geos.length;
    const color = o.css('--scene-water');
    if (geos.length) {
      const merged = mergeAll(geos);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      mats.push(mat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.userData.kind = 'site-water';
      mesh.userData.site = true;
      mesh.userData.receives = true;
      out.push(mesh);
      info.triangles += merged.index.count / 3;
    }
    const seg = [];
    for (const line of w.lines || []) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        seg.push(a[0], o.zOf(a[2]), -a[1], b[0], o.zOf(b[2]), -b[1]);
      }
    }
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const lmat = new THREE.LineBasicMaterial({ color });
      mats.push(lmat);
      const lines = new THREE.LineSegments(g, lmat);
      lines.userData.kind = 'site-water-lines';
      out.push(lines);
    }
  }

  /** Two InstancedMesh (low-poly canopy, thin trunk), like the Site Model. */
  function buildTrees(data, o, mats, out, info, zAt) {
    const trees = data.trees || [];
    if (!trees.length) return;
    info.trees = trees.length;
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunkGeo = new THREE.CylinderGeometry(0.55, 0.8, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const cm = new THREE.MeshStandardMaterial({ color: o.css('--scene-tree'), roughness: 0.94, metalness: 0, flatShading: true });
    const tm = new THREE.MeshStandardMaterial({ color: o.css('--scene-trunk'), roughness: 0.94, metalness: 0 });
    mats.push(cm, tm);
    const canopy = new THREE.InstancedMesh(canopyGeo, cm, trees.length);
    const trunk = new THREE.InstancedMesh(trunkGeo, tm, trees.length);
    const ky = o.identity ? 1 : o.zOf(1) - o.zOf(0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    trees.forEach((t, i) => {
      const e = o.hasGround ? zAt(t.x, t.y) : t.z, r = t.canopy / 2;
      p.set(t.x, o.zOf(e + t.height - r), -t.y); s.set(r, r * 0.9 * ky, r);
      canopy.setMatrixAt(i, m.compose(p, q, s));
      p.set(t.x, o.zOf(e), -t.y); s.set(1, (t.height - r) * ky, 1);
      trunk.setMatrixAt(i, m.compose(p, q, s));
    });
    canopy.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
    canopy.computeBoundingSphere(); trunk.computeBoundingSphere();
    for (const mesh of [trunk, canopy]) { mesh.userData.kind = 'site-trees'; mesh.userData.site = true; mesh.userData.casts = true; out.push(mesh); }
    info.triangles += (canopyGeo.index ? canopyGeo.index.count / 3 : 0) * trees.length + (trunkGeo.index ? trunkGeo.index.count / 3 : 0) * trees.length;
  }

  /* ---- public ---- */
  /** THREE objects for a data result of SiteLayerMod.buildSiteLayerData.
   *  opts: { parts: ['ground','boundary','buildings','roads','walks','water','trees'] (default all),
   *          zOf: (localZ) => worldY (default identity; the Grading Sketch passes its exaggeration mapper),
   *          css: (name, fallback) => THREE.Color, edges: true, shadows: true,
   *          rotation: placement rotation in degrees (turns the north arrow; default 0),
   *          zAt: (x, y) => local ground z (default: the drawn ground mesh) }
   *  Returns { objects: [THREE.Object3D], info: { ground, buildings, roads, walks, waterAreas, trees, triangles, bounds } }.
   *  Each object has userData.kind ('site-ground', 'site-skirt', 'site-boundary', 'site-arrow', 'site-buildings',
   *  'site-building-edges', 'site-roads', 'site-walks', 'site-water', 'site-water-lines', 'site-trees') and userData.site = true;
   *  userData.casts / userData.receives say which shadow flags setShadows() turns on. */
  function objects(data, opts = {}) {
    const info = { ground: false, buildings: 0, roads: 0, walks: 0, waterAreas: 0, trees: 0, triangles: 0, bounds: data && data.bounds ? { ...data.bounds } : null };
    const out = [], mats = [];
    if (!data || !data.ok) return { objects: out, info };
    const parts = new Set(Array.isArray(opts.parts) ? opts.parts : ALL_PARTS);
    const identity = typeof opts.zOf !== 'function';
    const o = {
      zOf: identity ? (z) => z : opts.zOf, identity,
      css: typeof opts.css === 'function' ? opts.css : defaultCss,
      edges: opts.edges !== false, rotation: opts.rotation || 0,
      hasGround: !!data.ground,
    };
    const sampler = makeSampler(data.ground);
    const zAt = typeof opts.zAt === 'function' ? opts.zAt : (sampler || (() => 0));
    if (parts.has('ground')) { buildGround(data, o, mats, out, info); info.ground = !!data.ground; }
    if (parts.has('boundary')) buildBoundary(data, o, mats, out, zAt);
    if (parts.has('buildings')) buildBuildings(data, o, mats, out, info);
    if (parts.has('roads')) buildPavement(data.roads, '--scene-road', 0.3, -2, 'site-roads', o, mats, out, info, zAt);
    if (parts.has('walks')) buildPavement(data.walks, '--scene-walk', 0.45, -4, 'site-walks', o, mats, out, info, zAt);
    if (parts.has('water')) buildWater(data, o, mats, out, info);
    if (parts.has('trees')) buildTrees(data, o, mats, out, info, zAt);
    info.triangles = Math.round(info.triangles);
    const shadows = opts.shadows !== false;
    for (const obj of out) {
      obj.userData.ownMaterials = mats;             // all of this call's materials; dispose() frees them once
      obj.castShadow = shadows && !!obj.userData.casts;
      obj.receiveShadow = shadows && !!obj.userData.receives;
    }
    return { objects: out, info };
  }

  /** Disposes the geometries and the own materials of objects made by objects(). Safe to call twice. */
  function dispose(objs) {
    const done = new Set();
    for (const o of objs || []) {
      if (o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
      const list = o.userData && o.userData.ownMaterials;
      if (list && !done.has(list)) { done.add(list); list.forEach((m) => m.dispose()); }
    }
  }

  /** Turns the shadow flags of objects made by objects() on or off (casters only when `cast`, receivers only when `receive`). */
  function setShadows(objs, cast, receive) {
    for (const o of objs || []) {
      if (!o.userData || !o.userData.site) continue;
      o.castShadow = !!cast && !!o.userData.casts;
      o.receiveShadow = !!receive && !!o.userData.receives;
    }
  }

  /** The cache key for a tool's syncLayer: `${siteUpdatedAt}|${x},${y},${rot},${baseZ}|${showFlags}|${themeEpoch}`.
   *  doc: the project document (or null); show: a string or an object of flags. */
  function keyFor(doc, placement, show, themeEpoch) {
    let stamp = '';
    try {
      const sec = ProjectMod.getSection(doc, 'site');
      if (sec) {
        const dv = sec.derived || {};
        stamp = `${sec.updatedAt || ''}#${dv.ground ? dv.ground.n : 0}.${(dv.buildings || []).length}`;
      }
    } catch (e) { stamp = ''; }
    const p = placement || {};
    const flags = show && typeof show === 'object' ? Object.keys(show).sort().map((k) => `${k}=${show[k] ? 1 : 0}`).join(',') : String(show === undefined ? '' : show);
    return `${stamp}|${p.x || 0},${p.y || 0},${p.rotation || 0},${p.baseZ || 0}|${flags}|${themeEpoch || 0}`;
  }

  /** The box a view frames when a site is open: the building box grown by max(150 ft, 0.6 x its larger plan span) on every side,
   *  then clamped to the site square, so the site runs past the edges of the view. A building that sticks out of the square stays inside the box.
   *  b, sb: { minX, maxX, minY, maxY } (b may carry height and minZ, which are kept). → a new box. */
  function frameAround(b, sb) {
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const m = Math.max(150, 0.6 * span);
    return {
      ...b,
      minX: Math.min(b.minX, Math.max(b.minX - m, sb.minX)), maxX: Math.max(b.maxX, Math.min(b.maxX + m, sb.maxX)),
      minY: Math.min(b.minY, Math.max(b.minY - m, sb.minY)), maxY: Math.max(b.maxY, Math.min(b.maxY + m, sb.maxY)),
    };
  }

  return { objects, dispose, setShadows, keyFor, makeSampler, frameAround };
})();
