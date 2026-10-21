/* ==========================================================================
   SCENE
   Three.js view of the site model. Same render style as the Tower Generator:
   white model, dark edges, soft hemisphere + sun light, colors read from the CSS tokens.
   Plan coordinates (x east, y north, elevation up) map to world [x, elevation, -y]
   (north is world -z). planToWorld() and planMatrix() are the only places that write the mapping.
   Vertical scale is the root group's y scale about the ground minimum, so buildings stay on the ground.
   Everything draped on the ground (roads, walks, water lines, trees, outline) samples the ground MESH
   (same triangles as the drawn surface), so nothing floats or sinks.
   ========================================================================== */
function planToWorld(x, y, elev = 0) { return [x, elev, -y]; }
const worldVec = (x, y, e = 0) => new THREE.Vector3(...planToWorld(x, y, e));
/** Matrix for geometry authored in plan space (shape x, y; extrusion up = elevation), lifted by `elev`. */
function planMatrix(elev = 0) {
  return new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, elev,
    0, -1, 0, 0,
    0, 0, 0, 1);
}

const Scene = (() => {
  const FOV = 30;
  const tanHalfFov = Math.tan(rad(FOV) / 2);
  const FIT_MARGIN = 0.04;
  const EDGE_ANGLE = 30;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let host, renderer, scene, cam, controls, root, sun, hemi;
  let needsRender = true, capturing = false, tween = null, sceneRadius = 500;
  let site = null;                          // { model, S, gmin, gmax, top, meshAt }
  let vscale = 1, contour = 0;
  const cameraListeners = [];
  const layerVisible = { ground: true, buildings: true, roads: true, walks: false, trees: true, water: true };
  const G = {};                             // layer groups
  const M = {};                             // materials
  const info = { buildings: 0, buildingMeshes: 0, trees: 0, waterAreas: 0, roadTriangles: 0, walkTriangles: 0, triangles: 0 };
  const contourU = { uInterval: { value: 2 }, uOn: { value: 0 }, uContourColor: { value: new THREE.Color('#3a424a') } };

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const cssColor = (name, fallback = '#888') => new THREE.Color(css(name) || fallback);

  /* ---- materials ----------------------------------------------------------- */
  function makeMaterials() {
    const std = (extra = {}) => new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, ...extra });
    M.ground = std({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    M.ground.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, contourU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vElev;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vElev; uniform float uInterval; uniform float uOn; uniform vec3 uContourColor;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float c1 = vElev / uInterval;
            float w1 = max(fwidth(c1), 1e-5);
            float d1 = abs(fract(c1 - 0.5) - 0.5) / w1;
            float m1 = (1.0 - smoothstep(0.3, 0.95, d1)) * (1.0 - smoothstep(0.22, 0.5, w1));
            float c5 = c1 / 5.0;
            float w5 = max(fwidth(c5), 1e-5);
            float d5 = abs(fract(c5 - 0.5) - 0.5) / w5;
            float m5 = (1.0 - smoothstep(0.85, 1.6, d5)) * (1.0 - smoothstep(0.22, 0.5, w5));
            float a = max(m1 * 0.5, m5 * 0.9) * uOn;
            diffuseColor.rgb = mix(diffuseColor.rgb, uContourColor, a);
          }`);
    };
    M.ground.customProgramCacheKey = () => 'site-ground-contour';
    M.skirt = std({ roughness: 1 });
    M.building = std();
    M.estimate = std();
    M.edge = new THREE.LineBasicMaterial();
    M.road = std({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.walk = std({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    M.water = std({ roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    M.waterLine = new THREE.LineBasicMaterial();
    M.canopy = std({ flatShading: true });
    M.trunk = std();
    M.site = new THREE.LineBasicMaterial();
  }
  function applyTheme() {
    if (!scene) return;
    scene.background = cssColor('--scene-sky');
    M.skirt.color.copy(cssColor('--scene-skirt'));
    M.building.color.copy(cssColor('--scene-model'));
    M.estimate.color.copy(cssColor('--scene-est'));
    M.edge.color.copy(cssColor('--scene-edge'));
    M.road.color.copy(cssColor('--scene-road'));
    M.walk.color.copy(cssColor('--scene-walk'));
    M.water.color.copy(cssColor('--scene-water'));
    M.waterLine.color.copy(cssColor('--scene-water'));
    M.canopy.color.copy(cssColor('--scene-tree'));
    M.trunk.color.copy(cssColor('--scene-trunk'));
    M.site.color.copy(cssColor('--scene-site'));
    contourU.uContourColor.value.copy(cssColor('--scene-contour'));
    M.ground.color.set(0xffffff);
    paintGround();
    needsRender = true;
  }

  /* ---- scene ------------------------------------------------------------------ */
  function buildScene() {
    scene = new THREE.Scene();
    hemi = new THREE.HemisphereLight(0xffffff, 0xb4bac2, 2.0);
    sun = new THREE.DirectionalLight(0xffffff, 1.8);
    scene.add(hemi, sun, sun.target);
    root = new THREE.Group();
    scene.add(root);
    for (const k of ['ground', 'site', 'buildings', 'roads', 'walks', 'trees', 'water']) {
      G[k] = new THREE.Group();
      G[k].visible = k === 'site' ? true : !!layerVisible[k];
      root.add(G[k]);
    }
  }

  function clearGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    }
  }

  /* ---- ground mesh -------------------------------------------------------------- */
  let groundGeo = null, skirtGeo = null, skirtBottom = [];

  /** Elevation of the drawn ground surface at (x, y): same two triangles per cell as buildGroundMesh. */
  function makeMeshAt(ground) {
    const { n, spacing: d, z } = ground, L = (n - 1) * d;
    return (x, y) => {
      const cx = clamp(x, 0, L) / d, cy = clamp(y, 0, L) / d;
      const i = Math.min(Math.floor(cx), n - 2), j = Math.min(Math.floor(cy), n - 2);
      const u = cx - i, v = cy - j, o = j * n + i;
      const za = z[o], zb = z[o + 1], zc = z[o + n + 1], zd = z[o + n];
      return u >= v ? za + u * (zb - za) + v * (zc - zb) : za + u * (zc - zd) + v * (zd - za);
    };
  }

  function buildGroundMesh(ground) {
    const { n, xs, ys, z } = ground;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = xs[i]; pos[k + 1] = z[j * n + i]; pos[k + 2] = -ys[j];
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = a; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    groundGeo = geo;
    const mesh = new THREE.Mesh(geo, M.ground);
    mesh.userData.kind = 'ground';
    return mesh;
  }

  function paintGround() {
    if (!groundGeo || !site) return;
    const lo = cssColor('--scene-terrain-lo'), hi = cssColor('--scene-terrain-hi');
    const { z } = site.model.ground, col = groundGeo.getAttribute('color');
    const range = site.gmax - site.gmin, c = new THREE.Color();
    for (let k = 0; k < z.length; k++) {
      c.copy(lo).lerp(hi, range > 0.5 ? (z[k] - site.gmin) / range : 0.5);
      col.setXYZ(k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  /** Thin plate under the ground so the site reads as a physical model. Bottom depth stays constant on screen. */
  function buildSkirt(ground) {
    const { n, xs, ys, z } = ground;
    const sides = [
      (k) => [xs[k], ys[0], z[k], 0, -1],                         // south, travelling east
      (k) => [xs[n - 1], ys[k], z[k * n + n - 1], 1, 0],          // east, travelling north
      (k) => [xs[n - 1 - k], ys[n - 1], z[(n - 1) * n + n - 1 - k], 0, 1],   // north, travelling west
      (k) => [xs[0], ys[n - 1 - k], z[(n - 1 - k) * n], -1, 0],   // west, travelling south
    ];
    const pos = [], nor = [], idx = [];
    skirtBottom = [];
    for (const side of sides) {
      const base = pos.length / 3;
      for (let k = 0; k < n; k++) {
        const [x, y, e, nx, ny] = side(k);
        pos.push(x, e, -y, x, e, -y);                 // top, bottom (bottom is set by setSkirtBottom)
        nor.push(nx, 0, -ny, nx, 0, -ny);
        skirtBottom.push(pos.length / 3 - 1);
      }
      for (let k = 0; k < n - 1; k++) {
        const t0 = base + 2 * k, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
        idx.push(t0, b0, t1, t1, b0, b1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    skirtGeo = geo;
    setSkirtBottom();
    return new THREE.Mesh(geo, M.skirt);
  }
  function setSkirtBottom() {
    if (!skirtGeo || !site) return;
    const yb = site.gmin - Math.max(8, site.S * 0.03) / vscale;
    const p = skirtGeo.getAttribute('position');
    for (const k of skirtBottom) p.setY(k, yb);
    p.needsUpdate = true;
    skirtGeo.computeBoundingSphere();
  }

  function buildOutline(ground, meshAt) {
    const { n, xs, ys } = ground, pts = [];
    const add = (x, y) => pts.push(worldVec(x, y, meshAt(x, y) + 0.6));
    for (let k = 0; k < n - 1; k++) add(xs[k], ys[0]);
    for (let k = 0; k < n - 1; k++) add(xs[n - 1], ys[k]);
    for (let k = n - 1; k > 0; k--) add(xs[k], ys[n - 1]);
    for (let k = n - 1; k > 0; k--) add(xs[0], ys[k]);
    return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), M.site);
  }

  /* ---- buildings ------------------------------------------------------------------ */
  function buildBuildings(buildings) {
    const data = [], est = [];
    let count = 0;
    for (const b of buildings) {
      try {
        if (!b.ring || b.ring.length < 3) continue;
        const shape = new THREE.Shape(b.ring.map((q) => new THREE.Vector2(q[0], q[1])));
        for (const hole of b.holes || []) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((q) => new THREE.Vector2(q[0], q[1]))));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height + 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
        geo.deleteAttribute('uv');
        geo.applyMatrix4(planMatrix(b.base - 1));
        (b.rule === 'estimate' ? est : data).push(geo);
        count++;
      } catch (e) { console.warn('building skipped', b && b.id, e); }
    }
    const out = [];
    for (const [list, mat] of [[data, M.building], [est, M.estimate]]) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
      if (list.length > 1) list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.userData.kind = 'buildings';
      out.push(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(merged, EDGE_ANGLE), M.edge));
    }
    info.buildings = count;
    info.buildingMeshes = out.filter((o) => o.isMesh).length;
    return out;
  }

  /* ---- draped polygons (roads, walks) and flat polygons (water) ------------------------ */
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
  /** polys: [{outer, holes}]. zOf(x, y) gives the elevation. Returns a BufferGeometry (or null). */
  function polyGeometry(polys, zOf, step) {
    const pos = [], idx = [];
    for (const p of polys) {
      try {
        const outer = step ? densifyRing(trimRing(p.outer), step) : trimRing(p.outer);
        const holes = (p.holes || []).map((hh) => (step ? densifyRing(trimRing(hh), step) : trimRing(hh)));
        const tris = THREE.ShapeUtils.triangulateShape(outer.map((q) => new THREE.Vector2(q[0], q[1])), holes.map((hh) => hh.map((q) => new THREE.Vector2(q[0], q[1]))));
        const all = outer.concat(...holes), base = pos.length / 3;
        for (const q of all) pos.push(q[0], zOf(q[0], q[1]), -q[1]);
        for (const [a, b, c] of tris) {
          // world winding must face up
          const ax = all[a][0], ay = all[a][1], bx = all[b][0], by = all[b][1], cx = all[c][0], cy = all[c][1];
          const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;      // plan CCW = facing up
          if (ccw) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
        }
      } catch (e) { console.warn('polygon skipped', e); }
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function buildPavement(polys, mat, lift, key) {
    if (!polys || !polys.length) { info[key] = 0; return []; }
    const geo = polyGeometry(polys, (x, y) => site.meshAt(x, y) + lift, 10);
    if (!geo) { info[key] = 0; return []; }
    info[key] = geo.index.count / 3;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.kind = key;
    return [mesh];
  }

  function buildWater(water) {
    const out = [];
    const areas = (water.areas || []).map((a) => ({ outer: a.ring, holes: a.holes, level: a.level }));
    info.waterAreas = areas.length;
    // one geometry per area: each has its own flat level
    const geos = [];
    for (const a of areas) {
      const g = polyGeometry([a], () => a.level, 0);
      if (g) geos.push(g);
    }
    if (geos.length) {
      const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      out.push(new THREE.Mesh(merged, M.water));
    }
    const seg = [];
    for (const line of water.lines || []) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        seg.push(a[0], site.meshAt(a[0], a[1]) + 0.4, -a[1], b[0], site.meshAt(b[0], b[1]) + 0.4, -b[1]);
      }
    }
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      out.push(new THREE.LineSegments(g, M.waterLine));
    }
    return out;
  }

  /* ---- trees: instanced low-poly canopy + thin trunk -------------------------------------- */
  function buildTrees(trees) {
    info.trees = trees.length;
    if (!trees.length) return [];
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunkGeo = new THREE.CylinderGeometry(0.55, 0.8, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const canopy = new THREE.InstancedMesh(canopyGeo, M.canopy, trees.length);
    const trunk = new THREE.InstancedMesh(trunkGeo, M.trunk, trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    trees.forEach((t, i) => {
      const e = site.meshAt(t.x, t.y), r = t.canopy / 2;
      p.set(t.x, e + t.height - r, -t.y); s.set(r, r * 0.9, r);
      canopy.setMatrixAt(i, m.compose(p, q, s));
      p.set(t.x, e, -t.y); s.set(1, t.height - r, 1);
      trunk.setMatrixAt(i, m.compose(p, q, s));
    });
    canopy.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
    canopy.computeBoundingSphere(); trunk.computeBoundingSphere();
    return [trunk, canopy];
  }

  /* ---- model in, scene out --------------------------------------------------------------------- */
  function countTriangles() {
    let t = 0;
    root.traverse((o) => {
      if (!o.visible || !o.geometry) return;
      const g = o.geometry, n = g.index ? g.index.count : g.getAttribute('position').count;
      if (o.isInstancedMesh) t += (n / 3) * o.count; else if (o.isMesh) t += n / 3;
    });
    return Math.round(t);
  }

  function setModel(model) {
    for (const k of Object.keys(G)) clearGroup(G[k]);
    const ground = model.ground;
    let top = ground.max;
    for (const b of model.buildings) top = Math.max(top, b.top);
    for (const t of model.trees) top = Math.max(top, t.z + t.height);
    site = { model, S: model.frame.size, gmin: ground.min, gmax: ground.max, top, meshAt: makeMeshAt(ground) };
    for (const k of ['buildings', 'trees', 'waterAreas', 'roadTriangles', 'walkTriangles']) info[k] = 0;
    G.ground.add(buildGroundMesh(ground), buildSkirt(ground));
    G.site.add(buildOutline(ground, site.meshAt));
    for (const o of buildBuildings(model.buildings)) G.buildings.add(o);
    for (const o of buildPavement(model.roads.pavement, M.road, 0.3, 'roadTriangles')) G.roads.add(o);
    for (const o of buildPavement(model.roads.walks, M.walk, 0.4, 'walkTriangles')) G.walks.add(o);
    for (const o of buildTrees(model.trees)) G.trees.add(o);
    for (const o of buildWater(model.water)) G.water.add(o);
    paintGround();
    applyScale();
    applyLayers();
    info.triangles = countTriangles();
    sceneRadius = Math.hypot(site.S, site.S, site.top - site.gmin) / 2;
    updateSun();
    fit(false);
    needsRender = true;
  }

  /** Replace the walks layer after a rebuild with walks:true (the roads object comes from Pipeline.buildWalks). */
  function setWalks(roads) {
    if (!site) return;
    site.model.roads = roads;
    clearGroup(G.walks);
    for (const o of buildPavement(roads.walks, M.walk, 0.4, 'walkTriangles')) G.walks.add(o);
    info.triangles = countTriangles();
    needsRender = true;
  }

  function applyLayers() {
    for (const k of Object.keys(layerVisible)) if (G[k]) G[k].visible = !!layerVisible[k];
    if (site) info.triangles = countTriangles();
    needsRender = true;
  }
  function setLayer(name, on) { layerVisible[name] = !!on; applyLayers(); }

  function applyScale() {
    if (!site) { root.scale.y = vscale; root.position.y = 0; return; }
    root.scale.y = vscale;
    root.position.y = site.gmin * (1 - vscale);
    setSkirtBottom();
    needsRender = true;
  }
  function setVScale(v) {
    const was = vscale;
    vscale = v;
    applyScale();
    if (site && was !== v) refit();
  }
  function setContour(ft) {
    contour = ft;
    contourU.uOn.value = ft > 0 ? 1 : 0;
    if (ft > 0) contourU.uInterval.value = ft;
    needsRender = true;
  }

  function updateSun() {
    const az = rad(150), alt = rad(46), R = Math.max(200, sceneRadius);
    const dir = new THREE.Vector3(...planToWorld(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)));
    const c = site ? worldVec(site.S / 2, site.S / 2, site.gmin) : new THREE.Vector3();
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(dir, R * 3);
    sun.target.updateMatrixWorld();
  }

  /* ---- camera & framing ------------------------------------------------------------------------- */
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const hostAspect = () => Math.max(0.1, host.clientWidth) / Math.max(1, host.clientHeight);

  /** Corners of what a view must show, in world space (vertical scale applied). */
  function fitCorners() {
    const S = site ? site.S : 1000, lo = site ? site.gmin : 0;
    const hi = site ? lo + (site.top - lo) * vscale : 50;
    const pts = [];
    for (const x of [0, S]) for (const y of [0, S]) for (const e of [lo, Math.max(hi, lo + S * 0.02)]) pts.push(worldVec(x, y, e));
    return pts;
  }
  /** Nearest distance (and look-at point) that puts all corners inside the view with a margin. */
  function fitPersp(corners, dir, aspect) {
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const fit = 1 - 2 * FIT_MARGIN;
    const tY = tanHalfFov, tX = tanHalfFov * aspect;
    const target = corners.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / corners.length);
    const solve = () => {
      let dist = 1;
      for (const p of corners) {
        const v = p.clone().sub(target), dd = v.dot(dir);
        dist = Math.max(dist, dd + Math.abs(v.dot(right)) / (tX * fit), dd + Math.abs(v.dot(up)) / (tY * fit));
      }
      return dist;
    };
    let dist = solve();
    for (let i = 0; i < 6; i++) {               // centre the projected box, then re-solve the distance
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of corners) {
        const v = p.clone().sub(target), z = dist - v.dot(dir);
        const nx = v.dot(right) / (z * tX), ny = v.dot(up) / (z * tY);
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
      }
      target.addScaledVector(right, ((x0 + x1) / 2) * tX * dist).addScaledVector(up, ((y0 + y1) / 2) * tY * dist);
      dist = solve();
    }
    return { dist, target };
  }

  let preset = 'fit';
  const presetListeners = [];
  const setPreset = (p) => { preset = p; presetListeners.forEach((fn) => fn(p)); };
  const VIEW_DIRS = {
    fit: () => new THREE.Vector3(...planToWorld(Math.sin(rad(225)) * Math.cos(rad(32)), Math.cos(rad(225)) * Math.cos(rad(32)), Math.sin(rad(32)))).normalize(),   // 3/4 view from the southwest
    plan: () => new THREE.Vector3(...planToWorld(0, -Math.sin(0.012), Math.cos(0.012))).normalize(),
  };
  function goTo(id, animate) {
    if (!renderer) return;
    setPreset(id);
    const dir = VIEW_DIRS[id]();
    const goal = fitPersp(fitCorners(), dir, hostAspect());
    setCamera(goal.target, dir, goal.dist, animate);
  }
  function setCamera(target, dir, dist, animate) {
    const apply = (t, d, r) => {
      controls.target.copy(t);
      cam.position.copy(t).addScaledVector(d, r);
      controls.update();
      needsRender = true;
    };
    tween = null;
    if (!animate || reduceMotion) { apply(target, dir, dist); return; }
    const curOffset = cam.position.clone().sub(controls.target);
    const fromDir = curOffset.clone().normalize(), fromDist = Math.max(1, curOffset.length());
    tween = {
      t0: performance.now(), dur: 450, fromTarget: controls.target.clone(), toTarget: target.clone(),
      fromDir, toDir: dir.clone(), fromDist, toDist: dist, apply,
      q: new THREE.Quaternion().setFromUnitVectors(fromDir, dir),
    };
    needsRender = true;
  }
  function stepTween(now) {
    const k = tween, p = clamp((now - k.t0) / k.dur, 0, 1), e = easeInOut(p);
    const dir = k.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(k.q, e)).normalize();
    k.apply(k.fromTarget.clone().lerp(k.toTarget, e), dir, k.fromDist + (k.toDist - k.fromDist) * e);
    if (p >= 1) tween = null;
  }
  const fit = (animate = true) => goTo('fit', animate);
  const planView = (animate = true) => goTo('plan', animate);
  function refit() { if (preset) goTo(preset, true); }

  function updateClip() {
    const dist = cam.position.distanceTo(controls.target);
    cam.near = Math.max(0.5, dist * 0.01);
    cam.far = dist * 20 + sceneRadius * 4 + 2000;
    cam.updateProjectionMatrix();
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(1, host.clientWidth), hh = Math.max(1, host.clientHeight);
    renderer.setSize(w, hh, false);
    cam.aspect = w / hh;
    cam.updateProjectionMatrix();
    if (site && preset) goTo(preset, false);
    needsRender = true;
    renderer.render(scene, cam);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (capturing) return;
    if (tween) stepTween(now);
    const moved = controls.update();
    if (moved || needsRender) {
      updateClip();
      renderer.render(scene, cam);
      needsRender = false;
      cameraListeners.forEach((fn) => fn(cam));
    }
  }

  /** Screenshot of what is on screen with the shared overlay. */
  async function capture(overlay, scale = 2) {
    if (!renderer) throw new Error('The 3D view is not available.');
    capturing = true;
    try { return await ShotMod.captureView({ renderer, scene, camera: cam, scale, overlay }); }
    finally { capturing = false; needsRender = true; }
  }

  function init(hostEl) {
    host = hostEl;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      host.innerHTML = '<div class="gl-fail">WebGL is not available in this browser, so the 3D view cannot start.</div>';
      renderer = null;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    makeMaterials();
    buildScene();
    cam = new THREE.PerspectiveCamera(FOV, 1, 1, 100000);
    cam.position.set(-900, 700, 900);
    controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;      // never below the ground
    controls.minDistance = 15;
    controls.maxDistance = 40000;
    controls.screenSpacePanning = true;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('start', () => { tween = null; if (preset) setPreset(null); });
    controls.addEventListener('change', () => { needsRender = true; });
    new ResizeObserver(resize).observe(host);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', applyTheme); else if (mq.addListener) mq.addListener(applyTheme);
    renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    applyTheme();
    updateSun();
    resize();
    requestAnimationFrame(frame);
    return true;
  }

  return {
    init, setModel, setWalks, setLayer, setVScale, setContour, fit, planView, capture,
    onCamera: (fn) => cameraListeners.push(fn),
    onPreset: (fn) => presetListeners.push(fn),
    camera: () => cam,
    ready: () => !!renderer,
    hasSite: () => !!site,
    info: () => ({ ...info, triangles: site ? countTriangles() : 0, vscale, contour, layers: { ...layerVisible }, preset, camDistance: cam ? cam.position.distanceTo(controls.target) : 0 }),
    /** For tests: render now and read a pixel row to prove something was drawn. */
    renderNow: () => { if (renderer) { updateClip(); renderer.render(scene, cam); } },
    meshAt: (x, y) => (site ? site.meshAt(x, y) : 0),
    groups: () => G,
    drawCalls: () => (renderer ? renderer.info.render.calls : 0),
  };
})();
