/* ==========================================================================
   PLATE 3D
   Builds the three.js objects of a plate fill from one Derived result (plan section 6):
     the plate slab (white), the units as thin slabs (white in Model style, colored by type in Diagram style) with dark demising lines and
     the corridor wall line, the corridor (light gray), the core and the stairs (mid gray, with tread lines), the elevators (crossed boxes),
     support blocks and pockets (hatched), unit labels (type and area), accessible symbols, red outlines on flagged units, amber outlines
     on locked units, bay-line handles, the context (other level groups as a faint outline, site neighbors as a ghost).
   Every drawn level comes from D.scene.levels: { index, name, z, ftf, editing, plate, corridor, core, stairs, elevators, support, units }.
   With "3D levels" off, only the editing level is drawn, at elevation 0; with it on, every filled level stands at its z and ftf.
   Everything the renderer owns (materials) is created here with userData.ownMat, so the renderer disposes it on rebuild.
   ========================================================================== */
const Plate3D = (() => {
  const css = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  const col = (hex) => new THREE.Color(hex);

  /* ---- fat lines (LineSegments2): width in CSS pixels, the renderer sets the resolution each frame ---- */
  function fat(pos, hex, width, o = {}) {
    if (!pos.length) return null;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const op = o.opacity == null ? 1 : o.opacity;
    const mat = new LineMaterial({ color: col(hex).getHex(), linewidth: width, transparent: op < 1, opacity: op, depthWrite: false, depthTest: o.depthTest !== false, dashed: !!o.dashed, dashSize: o.dash || 3, gapSize: o.gap || 2 });
    const ls = new LineSegments2(geo, mat);
    if (o.dashed) ls.computeLineDistances();
    ls.renderOrder = o.order == null ? 5 : o.order; ls.frustumCulled = false; ls.userData.ownMat = true;
    return ls;
  }
  const ringSegs = (out, ring, z) => { for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; out.push(a[0], z, -a[1], b[0], z, -b[1]); } };
  const lineSeg = (out, a, b, z) => { out.push(a[0], z, -a[1], b[0], z, -b[1]); };

  /** A THREE.Shape from a ring and its holes. */
  function shapeOf(outer, holes) {
    const sh = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    for (const h2 of holes || []) if (h2 && h2.length >= 3) sh.holes.push(new THREE.Path(h2.map((p) => new THREE.Vector2(p[0], p[1]))));
    return sh;
  }
  /** An extruded plan polygon from elevation z0 up by height (geometry authored in plan space, then mapped to the Y-up world). */
  function slabGeo(outer, holes, z0, height) {
    let geo;
    try {
      geo = height > 0.001 ? new THREE.ExtrudeGeometry(shapeOf(outer, holes), { depth: height, bevelEnabled: false, curveSegments: 1 }) : new THREE.ShapeGeometry(shapeOf(outer, holes), 1);
    } catch (e) { return null; }
    geo.applyMatrix4(planMatrix(z0));
    return geo;
  }
  function tint(geo, color) {
    const n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[3 * i] = color.r; arr[3 * i + 1] = color.g; arr[3 * i + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }
  function mergedMesh(geos, { roughness = 0.95, order = 0, opacity = 1, pick = null } = {}) {
    const list = geos.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
    if (!list.length) return null;
    for (const g of list) if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const geo = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
    if (!geo) return null;
    if (list.length > 1) list.forEach((g) => g.dispose());
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: opacity < 1, opacity });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.model = true; mesh.userData.ownMat = true; mesh.renderOrder = order;
    if (pick) mesh.userData.pick = pick;
    return mesh;
  }

  const polyRings = (mp) => (mp || []).filter((p) => p && p.outer && p.outer.length >= 3);

  /** Diagonal hatch lines inside a ring: sampled so any simple polygon works. → plan segments [[a, b], …] */
  function hatch(ring, spacing = 2.4, step = 0.6) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const out = [];
    const span = (maxX - minX) + (maxY - minY);
    for (let k = -(maxY - minY); k <= (maxX - minX); k += spacing) {
      let start = null, prev = null;
      for (let t = 0; t <= span; t += step) {
        const x = minX + k + t, y = minY + t * 1;
        const inside = x >= minX - 1e-9 && x <= maxX + 1e-9 && y >= minY - 1e-9 && y <= maxY + 1e-9 && pointInRing(x, y, ring);
        if (inside) { if (!start) start = [x, y]; prev = [x, y]; } else if (start) { if (prev && Math.hypot(prev[0] - start[0], prev[1] - start[1]) > 0.4) out.push([start, prev]); start = null; prev = null; }
      }
      if (start && prev && Math.hypot(prev[0] - start[0], prev[1] - start[1]) > 0.4) out.push([start, prev]);
    }
    return out;
  }

  /** The length of a ring along its longest edge (the run length of an unfilled run), ft. */
  function ringLong(ring) {
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 1e-6 && (!best || L > best.L)) best = { L, t: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
    }
    if (!best) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const p of ring) { const q = p[0] * best.t[0] + p[1] * best.t[1]; if (q < lo) lo = q; if (q > hi) hi = q; }
    return hi - lo;
  }
  const ringMinSide = (ring) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };
  /** The short word on a support block or a core room (rework plan 7.1). */
  const KIND_LABELS = { pocket: 'Pocket', trim: 'Storage', leftover: 'Leftover', stair: 'Stair', elevator: 'Elev', 'service-elevator': 'Svc', trash: 'Trash', electrical: 'Elec', shaft: 'Shaft', linen: 'Linen', ice: 'Ice', data: 'Data', storage: 'Storage' };
  const kindLabel = (k) => KIND_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');

  /** Stair treads across the long side of the ring's bounding box. */
  function treads(ring, tread = 1.0) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const out = [];
    if ((x1 - x0) >= (y1 - y0)) { for (let x = x0 + tread; x < x1 - 0.2; x += tread) out.push([[x, y0], [x, y1]]); }
    else { for (let y = y0 + tread; y < y1 - 0.2; y += tread) out.push([[x0, y], [x1, y]]); }
    return out;
  }
  const cross = (ring) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return [[[x0, y0], [x1, y1]], [[x0, y1], [x1, y0]]];
  };

  /** Context rings: the plates of the other level groups as a faint outline. */
  function contextObjects(D, state, opts = {}) {
    const out = [];
    if (!state.view.context || !D.scene) return out;
    if (!opts.massing) {        // with the massing drawn, the other level groups are solids and the faint outlines would only repeat them
      const pos = [];
      for (const rings of D.scene.contextRings || []) for (const r of rings) ringSegs(pos, r, 0.02);
      const f = fat(pos, '#8a949f', 1, { opacity: 0.55, order: 3 });
      if (f) out.push(f);
    }
    // site neighbors (a ghost)
    const geos = [];
    for (const p of ProjectUI.contextPolys()) {
      if (!p.outer || p.outer.length < 3) continue;
      const g = slabGeo(p.outer, p.holes, 0, Math.min(120, Math.max(8, num(p.height, 30))));
      if (g) geos.push(g);
    }
    const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    if (list.length) {
      for (const g of list) if (g.getAttribute('uv')) g.deleteAttribute('uv');
      const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
      if (merged) {
        if (list.length > 1) list.forEach((g) => g.dispose());
        merged.computeVertexNormals();
        const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: col('#9aa3ad'), roughness: 0.95, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }));
        mesh.userData.model = true; mesh.userData.ownMat = true; mesh.userData.context = true; mesh.renderOrder = 4;
        out.push(mesh);
      }
    }
    return out;
  }

  /** One level → model meshes and overlay lines and labels. `stack` = true draws at the level's z and the full floor height. */
  function levelObjects(L, state, stack, model, overlay) {
    const diagram = state.view.style === 'diagram';
    const z0 = stack ? L.z : 0;
    const slab = stack ? Math.max(1, L.ftf - 1) : CONFIG.slabHeight;
    const modelC = css('--scene-model', '#f6f6f3');
    const lineHex = getComputedStyle(document.documentElement).getPropertyValue('--scene-edge').trim() || CONFIG.lineColor;
    const top = z0 + slab + 0.08;

    // plate slab (thin, under everything)
    const plateGeos = [];
    for (const p of polyRings(L.plate)) { const g = slabGeo(p.outer, p.holes, z0 - 0.5, 0.5); if (g) plateGeos.push(tint(g, modelC)); }
    const pm = mergedMesh(plateGeos); if (pm) { pm.userData.plate = true; model.push(pm); }

    // corridor
    const corGeos = [];
    for (const p of polyRings(L.corridor)) { const g = slabGeo(p.outer, p.holes, z0, 0.1); if (g) corGeos.push(tint(g, col(CONFIG.corridorColor))); }
    const cm = mergedMesh(corGeos); if (cm) { cm.userData.corridor = true; model.push(cm); }

    // core, stairs, elevators, support, pockets
    const blockGeos = [];
    const addBlock = (ring, hex, h) => { if (!ring || ring.length < 3) return; const g = slabGeo(ring, [], z0, h); if (g) blockGeos.push(tint(g, col(hex))); };
    if (L.core) addBlock(L.core, CONFIG.coreColor, slab);
    for (const s of L.stairs) addBlock(s.outer, CONFIG.stairColor, slab);
    for (const e of L.elevators) addBlock(e.outer, CONFIG.elevColor, slab);
    for (const b of L.support) addBlock(b.outer, b.kind === 'remainder' ? CONFIG.remainderColor : b.kind === 'pocket' || b.kind === 'leftover' || b.kind === 'trim' ? CONFIG.pocketColor : CONFIG.supportColor, slab * (b.kind === 'remainder' ? 0.3 : 0.8));
    const bm = mergedMesh(blockGeos); if (bm) { bm.userData.blocks = true; model.push(bm); }

    // units
    const unitGeos = [];
    for (const u of L.units) {
      const g = slabGeo(u.outer, [], z0, slab);
      if (!g) continue;
      unitGeos.push(tint(g, diagram ? col(u.color || '#cfd6dd') : modelC));
    }
    const um = mergedMesh(unitGeos, { roughness: 0.9 }); if (um) { um.userData.units = true; model.push(um); }

    // lines
    const dem = [], outl = [], walls = [], det = [];
    for (const u of L.units) {
      ringSegs(outl, u.outer, top);
      for (const ln of u.demising || []) lineSeg(dem, ln[0], ln[1], top + 0.02);
    }
    if (state.view.walls) for (const ln of L.wallLines || []) lineSeg(walls, ln[0], ln[1], top + 0.02);
    for (const p of polyRings(L.plate)) { ringSegs(det, p.outer, top); for (const h2 of p.holes || []) ringSegs(det, h2, top); }
    for (const p of polyRings(L.corridor)) { ringSegs(det, p.outer, top); for (const h2 of p.holes || []) ringSegs(det, h2, top); }
    const blockRings = [L.core, ...L.stairs.map((s) => s.outer), ...L.elevators.map((e) => e.outer), ...L.support.filter((b) => b.kind !== 'remainder').map((b) => b.outer)].filter((r) => r && r.length >= 3);
    for (const r of blockRings) ringSegs(det, r, top);
    // core rooms: each one a separate rectangle with a thin line (rework plan 7.1)
    const roomLines = [];
    for (const r of L.coreRooms || []) if (r.outer && r.outer.length >= 3) ringSegs(roomLines, r.outer, top + 0.015);
    // an unfilled run: no hatch, a dashed dark outline
    const gaps = [];
    for (const b of L.support) if (b.kind === 'remainder') ringSegs(gaps, b.outer, top + 0.02);
    // large units (area above the type's range on a deep run): a thin orange outline
    const big = [];
    for (const u of L.units) if (u.areaHigh) ringSegs(big, u.outer, top + 0.03);
    const hat = [], tr = [], xs = [];
    for (const b of L.support) if (b.kind !== 'remainder') for (const [a, c] of hatch(b.outer, 4.8, 0.8)) lineSeg(hat, a, c, top + 0.01);
    for (const s of L.stairs) for (const [a, c] of treads(s.outer)) lineSeg(tr, a, c, top + 0.01);
    for (const e of L.elevators) for (const [a, c] of cross(e.outer)) lineSeg(xs, a, c, top + 0.01);
    const L1 = [fat(det, lineHex, 1.2, { order: 5, opacity: 0.8 }), fat(outl, lineHex, 1, { order: 5, opacity: 0.55 }), fat(dem, lineHex, 1.6, { order: 6 }),
      fat(walls, lineHex, 1, { order: 6, dashed: true, dash: 1.5, gap: 1, opacity: 0.8 }), fat(hat, lineHex, 0.8, { order: 5, opacity: 0.4 }),
      fat(tr, lineHex, 0.8, { order: 5, opacity: 0.5 }), fat(xs, lineHex, 1, { order: 5, opacity: 0.7 }),
      fat(roomLines, lineHex, 0.8, { order: 5, opacity: 0.65 }), fat(gaps, lineHex, 1.4, { order: 6, dashed: true, dash: 2.4, gap: 1.6, opacity: 0.9 }),
      fat(big, CONFIG.areaHighColor, 1.8, { order: 7 })];
    for (const o of L1) if (o) { o.userData.level = L.index; overlay.push(o); }

    if (!L.editing && stack) return;
    // flagged (red) and locked (amber) outlines
    const flag = [], lock = [];
    for (const u of L.units) {
      if (u.flagged) ringSegs(flag, u.outer, top + 0.04);
      if (u.locked) ringSegs(lock, u.outer, top + 0.05);
    }
    const f1 = fat(flag, CONFIG.flagColor, 2.6, { order: 8 }), f2 = fat(lock, CONFIG.lockColor, 2.4, { order: 8, dashed: true, dash: 4, gap: 2 });
    for (const o of [f1, f2]) if (o) { o.userData.flags = true; overlay.push(o); }
  }

  /** The unit labels and the accessible marks of the editing level (flat text, scaled with the plan). */
  function labelObjects(D, state, overlay, atZ) {
    const L = D.scene && D.scene.levels.find((x) => x.editing);
    if (!L) return;
    const stack = !!state.view.levels3d || !!atZ;
    const z = (stack ? L.z + Math.max(1, L.ftf - 1) : CONFIG.slabHeight) + 0.2;
    const ub = D.bounds.union, unit = clamp(Math.max(ub.maxX - ub.minX, ub.maxY - ub.minY) / 300, 1, 2.2);
    const add = (text, x, y, o, tag) => {
      const lab = Overlays.label(text, x, y, z, o);
      lab.userData.plan = true; lab.userData.labelId = tag;
      overlay.push(lab);
    };
    if (state.view.labels) {
      for (const u of L.units) {
        const p = u.label || ringCentroidXY(u.outer);
        add(`${u.typeName}${u.areaHigh ? ' · large' : ''}\n${Math.round(u.area).toLocaleString('en-US')} sf`, p[0], p[1], { height: 2.5 * unit, color: u.flagged ? CONFIG.flagColor : u.areaHigh ? '#a85600' : '#1d2733' }, `u-${u.id}`);
      }
    }
    for (const u of L.units) {
      if (!u.accessible) continue;
      const p = u.label || ringCentroidXY(u.outer);
      add('A', p[0], p[1] - 7 * unit, { height: 3 * unit, color: CONFIG.accentColor }, `a-${u.id}`);
    }
    for (const b of L.support) {
      const p = ringCentroidXY(b.outer);
      if (b.kind === 'remainder') {
        add(`Unfilled · ${Units.formatFeetInches(ringLong(b.outer))}`, p[0], p[1], { height: 2 * unit, color: '#33404b' }, `b-${b.id}`);
        continue;
      }
      if (Math.abs(ringArea(b.outer)) < 20) continue;               // too small for a word
      add(kindLabel(b.kind), p[0], p[1], { height: 1.9 * unit, color: '#4a535c' }, `b-${b.id}`);
    }
    // the rooms of an auto core: a short word in each, sized to the room
    for (const r of L.coreRooms || []) {
      if (!r.outer || r.outer.length < 3) continue;
      const p = ringCentroidXY(r.outer), side = ringMinSide(r.outer);
      add(kindLabel(r.kind), p[0], p[1], { height: clamp(side * 0.3, 1.2, 2.6 * unit), color: '#3b454f' }, `r-${r.id}`);
    }
  }

  /** The viewer's mapper (the plan is drawn at its own elevation; no vertical exaggeration). */
  function mapper() { return { W: (x, y, e) => planToWorld(x, y, e), V: (x, y, e) => new THREE.Vector3(...planToWorld(x, y, e)) }; }

  function build(D, state, disp, opts = {}) {
    const model = [], overlay = [];
    if (!D.scene) return { model, overlay };
    const stack = !!state.view.levels3d;
    const atZ = !!opts.atZ;              // the editing level stands at its own z (inside the massing volume)
    const levels = stack ? D.scene.levels : D.scene.levels.filter((l) => l.editing);
    for (const L of levels) {
      try { levelObjects(L, state, stack || atZ, model, overlay); } catch (e) { console.error(e); }
    }
    if (opts.clean) return { model, overlay: overlay.filter((o) => !o.userData.flags) };
    try { labelObjects(D, state, overlay, atZ); } catch (e) { console.error(e); }
    return { model, overlay };
  }

  /** True when the editing level is drawn at its own z inside the massing volume: a project source, View > Massing on, a massing with levels. */
  function editingAtZ(state) {
    return !!state && state.source === 'project' && state.view.massing !== false && ProjectUI.massingSolids().length > 0;
  }

  /* ---- the project massing (the whole building as solids) -----------------------------------------------------
     Every massing level is an extrusion (plates with holes, from z to z + ftf) in the massing frame, in the model color with dark edges (the
     look of the Tower and of the site neighbors, white against their grey). Podium levels are softer (a little grey, fainter edges). The levels of
     the active group carry a slight accent (a tint and an accent ring on the top). The editing level is not in the volume: its fill stands there at its z
     (with "Levels in 3D" every filled level does). A "foot" extends the lowest levels down to the lowest ground under them.
     Each object has userData.massingKind: 'solid' (the volumes and their edges) or 'outline' (the footprint rings the Plan shows instead). */
  function massingObjects(D, state, opts = {}) {
    const out = [];
    const list = ProjectUI.massingSolids();
    if (!list.length || !D.ok) return out;
    const modelC = css('--scene-model', '#f6f6f3');
    const edgeHex = getComputedStyle(document.documentElement).getPropertyValue('--scene-edge').trim() || CONFIG.lineColor;
    const accent = col(CONFIG.accentColor);
    const active = new Set(D.group ? D.group.levels : []);
    const skip = new Set(state.view.levels3d ? D.scene.levels.map((l) => l.index) : D.editing ? [D.editing.index] : []);
    const podiumC = modelC.clone().lerp(col('#b9c0c8'), 0.22), activeC = modelC.clone().lerp(accent, 0.24);
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.94, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mark = (o, kind, extra = {}) => { o.userData.massing = true; o.userData.massingKind = kind; o.userData.ownMat = true; Object.assign(o.userData, extra); return o; };
    const lowZ = Math.min(...list.map((l) => l.z));
    const ringsTop = new Map();       // footprint ring → { ring, z, active } for the outline (one ring per footprint, at the highest level)
    const ringKey = (r) => r.map((p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`).join(';');
    for (const L of list) {
      const isActive = active.has(L.index), podium = L.zone === 'podium';
      const top = L.z + L.ftf;
      for (const p of L.plates) for (const r of [p.outer, ...(p.holes || [])]) {
        if (!r || r.length < 3) continue;
        const k = ringKey(r), cur = ringsTop.get(k);
        if (!cur || top > cur.z) ringsTop.set(k, { ring: r, z: top, active: isActive || (cur && cur.active) });
        else if (isActive) cur.active = true;
      }
      if (skip.has(L.index)) continue;
      const geos = [];
      for (const p of L.plates) { const g = slabGeo(p.outer, p.holes, L.z, L.ftf); if (g) geos.push(g); }
      const list2 = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      if (!list2.length) continue;
      for (const g of list2) if (g.getAttribute('uv')) g.deleteAttribute('uv');
      const geo = list2.length === 1 ? list2[0] : BufferGeometryUtils.mergeGeometries(list2, false);
      if (!geo) continue;
      if (list2.length > 1) list2.forEach((g) => g.dispose());
      geo.computeVertexNormals();
      const mesh = mark(new THREE.Mesh(geo, mat(isActive ? activeC : podium ? podiumC : modelC)), 'solid', { level: L.index, zone: L.zone, active: isActive, podium, massingMesh: true });
      mesh.renderOrder = 1;
      out.push(mesh);
      const em = new THREE.LineBasicMaterial({ color: col(edgeHex), transparent: podium, opacity: podium ? 0.6 : 1 });
      out.push(mark(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), em), 'solid', { level: L.index, massingEdges: true }));
      if (isActive) {
        const pos = [];
        for (const p of L.plates) { ringSegs(pos, p.outer, top + 0.05); for (const h2 of p.holes || []) ringSegs(pos, h2, top + 0.05); }
        const ring = fat(pos, CONFIG.accentColor, 1.6, { order: 6, opacity: 0.9 });
        if (ring) out.push(mark(ring, 'solid', { level: L.index, massingRing: true }));
      }
    }
    // the foot: the lowest levels continue down to the lowest ground under them
    const foot = Math.max(0, opts.foot || 0);
    if (foot > 0.05) {
      const geos = [];
      for (const L of list) if (Math.abs(L.z - lowZ) < 0.01) for (const p of L.plates) { const g = slabGeo(p.outer, p.holes, lowZ - foot, foot); if (g) geos.push(g); }
      const list2 = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      if (list2.length) {
        for (const g of list2) if (g.getAttribute('uv')) g.deleteAttribute('uv');
        const geo = list2.length === 1 ? list2[0] : BufferGeometryUtils.mergeGeometries(list2, false);
        if (geo) {
          if (list2.length > 1) list2.forEach((g) => g.dispose());
          geo.computeVertexNormals();
          out.push(mark(new THREE.Mesh(geo, mat(podiumC)), 'solid', { massingFoot: true }));
          out.push(mark(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: col(edgeHex), transparent: true, opacity: 0.6 })), 'solid', { massingFoot: true }));
        }
      }
    }
    // the outline the Plan shows instead of the volume: one ring per footprint, accent for the active group
    const plain = [], act = [];
    for (const { ring, z, active: a } of ringsTop.values()) ringSegs(a ? act : plain, ring, z);
    const o1 = fat(plain, edgeHex, 1.2, { order: 3, opacity: 0.8 }), o2 = fat(act, CONFIG.accentColor, 1.8, { order: 3, opacity: 0.95 });
    for (const o of [o1, o2]) if (o) out.push(mark(o, 'outline', { massingOutline: true }));
    return out;
  }

  return { build, contextObjects, massingObjects, editingAtZ, mapper, fat, hatch, treads, ringLong, kindLabel };
})();
