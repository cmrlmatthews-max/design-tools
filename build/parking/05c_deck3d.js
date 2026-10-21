/* ==========================================================================
   DECK 3D
   Builds the three.js objects of a parking deck from one Derived result (plan section 6):
     slabs (1 ft thick, one per level, sloped pieces for helix and sloped-floor bays), stall lines and (Diagram style) stall fills,
     ramps, columns, cores, barriers, plus the overlay layer (entry lanes, ramp arrows, slope labels, demising lines, stall numbers).
   Everything is authored in the LAYOUT frame, in plan feet, through planToWorld; the Render layer's matrix (frameMatrix) puts the
   group in the massing frame. Materials come from the renderer: mats.mesh(key), mats.line(key).
   Draft quality (a drag in progress): rows are drawn as filled strips, not single stalls, and columns are skipped.
   ========================================================================== */
const Deck3D = (() => {
  const W3 = (x, y, e) => planToWorld(x, y, e);
  const BAND_TYPES = new Set(['single-helix', 'double-helix', 'sloped-floor']);
  const kindOfStall = (s) => (s && CONFIG.kindColors[s.kind] ? s.kind : 'standard');

  /* ---- ramp geometry helpers ---------------------------------------------------- */
  function rampBox(r) {
    const b = boxOfRings([(r.outer3d || []).map((p) => [p[0], p[1]])]);
    return b;
  }
  /** z = a x + b y + c through the corners of a ramp (a planar quad). */
  function rampPlane(r) {
    const pts = r.outer3d || [];
    if (pts.length < 3) return null;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
      const p = pts[i], q = pts[j], s = pts[k];
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
      const det = ux * vy - uy * vx;
      if (Math.abs(det) < 1e-6) continue;
      const a = (uz * vy - uy * vz) / det, b = (ux * vz - uz * vx) / det;
      return { a, b, c: p[2] - a * p[0] - b * p[1] };
    }
    return null;
  }

  /** The pieces of a level: the plate cut into flat landings, sloped runs and the rest. Used for slabs, fills and heights. */
  function levelPieces(D, lv) {
    const plate = lv.plate || [];
    const box = boxOfPolys(plate);
    const out = { box, bands: [], voids: [] };
    if (!box) return out;
    for (const r of D.ramps || []) {
      if (!r || !Array.isArray(r.outer3d) || r.outer3d.length < 3) continue;
      const rb = rampBox(r);
      if (!rb) continue;
      if (r.level === lv.index && BAND_TYPES.has(r.type)) {
        const plane = rampPlane(r);
        if (!plane) continue;
        out.bands.push({ ramp: r, plane, box: rb, west: plane.a * rb.minX + plane.b * ((rb.minY + rb.maxY) / 2) + plane.c, east: plane.a * rb.maxX + plane.b * ((rb.minY + rb.maxY) / 2) + plane.c });
      } else if ((r.type === 'speed' && (r.level === lv.index || r.level === lv.index - 1)) || (r.type === 'split' && r.level === lv.index)) {
        const ring = r.footprint || (r.outer3d.length === 4 ? r.outer3d.map((p) => [p[0], p[1]]) : null);
        if (ring) out.voids.push({ ramp: r, ring });
      }
    }
    return out;
  }
  /** Height function (layout x, y) -> z for a level: sloped inside a band, flat landings at the band's ends, the level surface elsewhere. */
  function heightFn(D, lv) {
    const pc = levelPieces(D, lv);
    return (x, y) => {
      for (const b of pc.bands) {
        if (y >= b.box.minY - 1e-6 && y <= b.box.maxY + 1e-6) {
          const xc = clamp(x, b.box.minX, b.box.maxX);
          return b.plane.a * xc + b.plane.b * y + b.plane.c;
        }
      }
      return lv.z;
    };
  }

  /* ---- geometry builders --------------------------------------------------------- */
  function extrude(polys, z0, depth) {
    const shapes = polys.map((poly) => {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q[0], q[1])));
      for (const h of poly.holes || []) shape.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
      return shape;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(0.05, depth), bevelEnabled: false, steps: 1, curveSegments: 1 });
    geo.deleteAttribute('uv');
    geo.applyMatrix4(planMatrix(z0));
    return geo;
  }
  /** Flat or height-mapped fill of polys (ShapeGeometry), `lift` ft above fn(x, y). */
  function fill(polys, fn, lift) {
    const shapes = polys.map((poly) => {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q[0], q[1])));
      for (const h of poly.holes || []) shape.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
      return shape;
    });
    const geo = new THREE.ShapeGeometry(shapes, 1);
    geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
    const a = geo.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), y = a.getY(i);
      const p = W3(x, y, fn(x, y) + lift);
      a.setXYZ(i, p[0], p[1], p[2]);
    }
    a.needsUpdate = true;
    // ShapeGeometry faces +z in plan space; after the plan -> world map the winding flips, so draw double sided via the material
    geo.computeVertexNormals();
    return geo;
  }
  /** A closed prism from a 3D outline: top follows the outline, bottom is `t` ft lower. Quads are two triangles; other outlines are ear-clipped in plan. */
  function prism(outer3d, t) {
    let pts = outer3d.map((p) => [p[0], p[1], p[2]]);
    const flat = pts.map((p) => [p[0], p[1]]);
    if (ringArea(flat) < 0) pts = pts.reverse();
    const n = pts.length;
    const pos = [];
    const P = (p, dz) => W3(p[0], p[1], p[2] + dz);
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    let tris;
    try { tris = n === 4 ? [[0, 1, 2], [0, 2, 3]] : ExportsMod.parkTriangulate(pts.map((p) => [p[0], p[1]])); } catch (e) { tris = n >= 3 ? Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2]) : []; }
    for (const [i, j, k] of tris) {
      tri(P(pts[i], 0), P(pts[j], 0), P(pts[k], 0));            // top
      tri(P(pts[i], -t), P(pts[k], -t), P(pts[j], -t));          // bottom
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      tri(P(a, -t), P(b, -t), P(b, 0)); tri(P(a, -t), P(b, 0), P(a, 0));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }
  const boxGeo = (x0, y0, x1, y1, z0, z1) => {
    const geo = new THREE.BoxGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0));
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    geo.applyMatrix4(planMatrix(0));
    geo.deleteAttribute('uv');
    return geo;
  };
  const rectPoly = (x0, y0, x1, y1) => ({ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] });
  const within = (polys, rect) => (polys.length ? clipPolys(polys, [rect], 'and') : []);

  /* ---- slab, per level ---------------------------------------------------------------- */
  function slabGeos(D, lv) {
    const T = CONFIG.slabThickness;
    const pc = levelPieces(D, lv);
    const geos = [];
    const plate = lv.plate || [];
    if (!pc.box || !plate.length) return geos;
    const big = 1e5;
    let rest = plate;
    const cutters = [];
    for (const b of pc.bands) {
      cutters.push(rectPoly(pc.box.minX - 1, b.box.minY, pc.box.maxX + 1, b.box.maxY));
      const west = within(plate, rectPoly(pc.box.minX - 1, b.box.minY, b.box.minX, b.box.maxY));
      const east = within(plate, rectPoly(b.box.maxX, b.box.minY, pc.box.maxX + 1, b.box.maxY));
      if (west.length) geos.push(extrude(west, b.west - T, T));
      if (east.length) geos.push(extrude(east, b.east - T, T));
      geos.push(prism(b.ramp.outer3d, T));
    }
    for (const v of pc.voids) cutters.push({ outer: v.ring, holes: [] });
    if (cutters.length) rest = clipPolys(plate, cutters, 'diff');
    if (rest.length) geos.push(extrude(rest, lv.z - T, T));
    for (const v of pc.voids) {
      const r = v.ramp;
      if (r.level === lv.index && r.outer3d.length >= 3) geos.push(prism(r.outer3d, T));
    }
    void big;
    return geos;
  }

  /* ---- build ------------------------------------------------------------------------- */
  /**
   * D: the Derived result. disp: { quality: 'full' | 'draft' }. view: state.view. mats: { mesh(key), line(key) }.
   * → { model: [objects], overlay: [objects] } in the layout frame.
   */
  function build(D, state, disp, mats) {
    const view = state.view, diagram = view.style === 'diagram';
    const draft = disp.quality === 'draft';
    const only = view.level > 0 ? view.level : 0;
    const levels = (D.levels || []).filter((l) => !only || l.index === only);
    const model = [];
    const meshGroups = new Map();
    const pushMesh = (key, geo) => {
      if (!geo || !geo.getAttribute('position') || !geo.getAttribute('position').count) { if (geo) geo.dispose(); return; }
      if (!meshGroups.has(key)) meshGroups.set(key, []);
      meshGroups.get(key).push(geo);
    };
    const edgeGeos = [];
    const linePos = { stall: [], conflict: [] };
    const fillPos = new Map();     // kind -> positions
    const fillQuad = (kind, ring, fn, lift) => {
      if (!fillPos.has(kind)) fillPos.set(kind, []);
      const arr = fillPos.get(kind);
      const pts = ring.map((p) => W3(p[0], p[1], fn(p[0], p[1]) + lift));
      for (let i = 1; i + 1 < pts.length; i++) arr.push(...pts[0], ...pts[i], ...pts[i + 1]);
    };
    const ringLines = (arr, ring, fn, lift) => {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        arr.push(...W3(a[0], a[1], fn(a[0], a[1]) + lift), ...W3(b[0], b[1], fn(b[0], b[1]) + lift));
      }
    };
    const top = levels.length ? Math.max(...levels.map((l) => l.z + l.ftf)) : 0;
    const conflictKeys = new Set((D.overlay && D.overlay.conflicts ? D.overlay.conflicts : []).map((c) => `${rnd(c.column[0], 10)},${rnd(c.column[1], 10)}`));

    for (const lv of levels) {
      const fn = heightFn(D, lv);
      /* slab */
      for (const g of slabGeos(D, lv)) pushMesh(diagram ? 'slab-diagram' : 'slab', g);
      /* aisles and turn zones (Diagram style) */
      if (diagram && !draft) {
        const pc = levelPieces(D, lv);
        const asl = lv.aisles || [], tz = lv.turnZones || [];
        const pieces = (polys) => {
          if (!pc.bands.length) return [[polys, () => lv.z]];
          const out = [];
          let rest = polys;
          for (const b of pc.bands) {
            const rb = pc.box;
            const run = within(polys, rectPoly(b.box.minX, b.box.minY, b.box.maxX, b.box.maxY));
            const west = within(polys, rectPoly(rb.minX - 1, b.box.minY, b.box.minX, b.box.maxY));
            const east = within(polys, rectPoly(b.box.maxX, b.box.minY, rb.maxX + 1, b.box.maxY));
            if (run.length) out.push([run, (x, y) => b.plane.a * x + b.plane.b * y + b.plane.c]);
            if (west.length) out.push([west, () => b.west]);
            if (east.length) out.push([east, () => b.east]);
            rest = clipPolys(rest, [rectPoly(rb.minX - 1, b.box.minY, rb.maxX + 1, b.box.maxY)], 'diff');
          }
          if (rest.length) out.push([rest, () => lv.z]);
          return out;
        };
        for (const [polys, f] of pieces(asl)) pushMesh('aisle', fill(polys, f, 0.03));
        for (const [polys, f] of pieces(tz)) pushMesh('turn', fill(polys, f, 0.03));
      }
      /* stalls */
      if (draft) {
        const rows = new Map();
        for (const s of lv.stalls || []) {
          const key = `${s.bay}|${s.row}`;
          const b = rows.get(key) || { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
          for (const q of s.outer) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
          rows.set(key, b);
        }
        for (const b of rows.values()) {
          const ring = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
          fillQuad('standard', ring, fn, 0.04);
          ringLines(linePos.stall, ring, fn, 0.06);
        }
      } else {
        for (const s of lv.stalls || []) {
          const kind = kindOfStall(s);
          if (diagram && view.colorBy === 'kind') fillQuad(kind, s.outer, fn, 0.04);
          else if (diagram) fillQuad('standard', s.outer, fn, 0.04);
          else if (kind !== 'standard') fillQuad(kind, s.outer, fn, 0.04);
          ringLines(linePos.stall, s.outer, fn, 0.07);
        }
      }
      /* columns */
      if (!draft) {
        const pts = (D.columns && D.columns.points) || [];
        const c = num(state.grid.column, 2);
        const nextZ = (D.levels.find((l) => l.index === lv.index + 1) || {}).z;
        const isTop = nextZ === undefined;
        const z0 = lv.z, z1 = isTop ? lv.z + (state.levels.openTop ? 3 : lv.ftf - CONFIG.slabThickness) : nextZ - CONFIG.slabThickness;
        for (const p of pts) {
          const bad = conflictKeys.has(`${rnd(p[0], 10)},${rnd(p[1], 10)}`);
          pushMesh(bad ? 'column-bad' : 'column', boxGeo(p[0] - c / 2, p[1] - c / 2, p[0] + c / 2, p[1] + c / 2, Math.min(z0, fn(p[0], p[1])), Math.max(z0 + 1, z1)));
        }
      }
      /* barrier at the slab edge */
      const bh = num(state.checks.barrierProvided, 3.5);
      const thick = Math.max(0.4, num(state.footprint.perimeter, 1));
      for (const poly of lv.plate || []) {
        const inner = insetRing(poly.outer, thick);
        const wall = { outer: poly.outer, holes: inner ? [inner] : [] };
        if (inner) {
          // the wall rises from the slab top; on a helix level the landing heights differ, so it follows the level surface
          pushMesh('barrier', extrude([wall], lv.z, bh));
        }
      }
    }
    /* cores (whole height, all levels), drawn once */
    if (levels.length) {
      const zLow = Math.min(...levels.map((l) => l.z)) - CONFIG.slabThickness;
      for (const c of D.cores || []) {
        const issue = (D.coreIssues || {})[c.id];
        const key = issue ? 'core-bad' : `core-${c.kind}`;
        const b = c.box;
        pushMesh(key, boxGeo(b.minX, b.minY, b.maxX, b.maxY, zLow, top + (state.levels.openTop ? 9 : 0)));
      }
    }

    /* merge the mesh groups */
    for (const [key, geos] of meshGroups) {
      const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats.mesh(key));
      mesh.userData.model = true;
      mesh.userData.key = key;
      if (key === 'aisle' || key === 'turn') { mesh.renderOrder = 1; mesh.userData.model = false; }
      model.push(mesh);
      const edged = key === 'slab' || key === 'slab-diagram' || key === 'column' || key === 'column-bad' || key.startsWith('core') || key === 'barrier';
      if (edged && !(draft && key === 'barrier')) {
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 20), mats.line('edge'));
        edge.userData.edge = true;
        model.push(edge);
      }
    }
    /* stall fills */
    for (const [kind, pos] of fillPos) {
      if (!pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mesh = new THREE.Mesh(geo, mats.mesh(`kind:${kind}`));
      mesh.renderOrder = 2; mesh.frustumCulled = false;
      model.push(mesh);
    }
    if (linePos.stall.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(linePos.stall, 3));
      const ls = new THREE.LineSegments(geo, mats.line(diagram ? 'stall-diagram' : 'stall'));
      ls.renderOrder = 3; ls.frustumCulled = false;
      model.push(ls);
    }
    /* ramps coloured by slope (Diagram style): a thin tint over the sloped top */
    if (diagram) {
      for (const r of D.ramps || []) {
        if (!only || r.level === only) {
          if (!Array.isArray(r.outer3d) || r.outer3d.length < 3) continue;
          const lim = r.limit || 1;
          const key = !r.ok ? 'over' : Math.abs(r.slope) > 0.8 * lim ? 'near' : 'ok';
          const g = prism(r.outer3d.map((p) => [p[0], p[1], p[2] + 0.02]), 0.02);
          g.userData = { slope: key };
          const m = new THREE.Mesh(g, mats.mesh(`slope:${key}`));
          m.renderOrder = 1;
          model.push(m);
        }
      }
    }
    return { model, overlay: buildOverlay(D, state, disp, levels, mats) };
  }

  /* ---- overlay: entries, ramp arrows and labels, demising lines, stall numbers ------------ */
  function buildOverlay(D, state, disp, levels, mats) {
    const out = [];
    const view = state.view;
    if (disp.quality === 'draft') return out;
    const tag = (o) => { o.userData.plan = true; return o; };
    /* demising lines of the building above (thin orange), across the deck */
    if (view.overlay && D.demising && D.demising.length && D.box) {
      const topLv = levels.length ? levels[levels.length - 1] : null;
      const e = topLv ? topLv.z + topLv.ftf + 0.5 : 0.5;
      const pos = [];
      for (const x of D.demising) pos.push(...W3(x, D.box.minY, e), ...W3(x, D.box.maxY, e));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const ls = new THREE.LineSegments(geo, mats.line('demising'));
      ls.frustumCulled = false; ls.renderOrder = 5; ls.userData.keep = true;
      out.push(ls);
    }
    /* entries on the entry level: the lane and an arrow */
    const lv1 = levels.find((l) => l.index === 1) || levels[0];
    if (lv1 && D.box) {
      const pos = [];
      const lift = 0.2;
      const fn = heightFn(D, lv1);
      for (const en of state.entries || []) {
        const lane = entryLane(D, state, en);
        if (!lane) continue;
        for (let i = 0; i < 4; i++) {
          const a = lane.ring[i], b = lane.ring[(i + 1) % 4];
          pos.push(...W3(a[0], a[1], fn(a[0], a[1]) + lift), ...W3(b[0], b[1], fn(b[0], b[1]) + lift));
        }
        const c = lane.center, d = lane.dir;
        const tipX = c[0] + d[0] * 6, tipY = c[1] + d[1] * 6, tailX = c[0] - d[0] * 6, tailY = c[1] - d[1] * 6;
        const nx = -d[1], ny = d[0];
        pos.push(...W3(tailX, tailY, lift + fn(tailX, tailY)), ...W3(tipX, tipY, lift + fn(tipX, tipY)));
        pos.push(...W3(tipX, tipY, lift + fn(tipX, tipY)), ...W3(tipX - d[0] * 3 + nx * 3, tipY - d[1] * 3 + ny * 3, lift + fn(tipX, tipY)));
        pos.push(...W3(tipX, tipY, lift + fn(tipX, tipY)), ...W3(tipX - d[0] * 3 - nx * 3, tipY - d[1] * 3 - ny * 3, lift + fn(tipX, tipY)));
        out.push(tag(Overlays.label(en.id, c[0], c[1], lv1.z + 0.3, { height: 3.2, color: '#1b4a99' })));
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const ls = new THREE.LineSegments(geo, mats.line('entry'));
        ls.frustumCulled = false; ls.renderOrder = 5; ls.userData.keep = true;
        out.push(ls);
      }
    }
    /* ramp labels and climb arrows (plan view and Diagram style) */
    {
      for (const r of D.ramps || []) {
        if (!Array.isArray(r.outer3d) || r.outer3d.length < 3) continue;
        if (view.level > 0 && r.level !== view.level) continue;
        if (r.level !== (view.level || 1) && !view.level) continue;       // label the first level's ramps only, to keep the plan readable
        const b = rampBox(r);
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const zc = r.outer3d.reduce((t, p) => t + p[2], 0) / r.outer3d.length;
        out.push(tag(Overlays.label(`${(Math.abs(r.slope) * 100).toFixed(1)}%`, cx, cy, zc + 0.4, { height: 4, color: r.ok ? '#1d2733' : '#b02a2a' })));
        const plane = rampPlane(r);
        if (plane && (Math.abs(plane.a) > 1e-9 || Math.abs(plane.b) > 1e-9)) {
          const len = Math.hypot(plane.a, plane.b), dx = plane.a / len, dy = plane.b / len;
          const L = Math.min(18, (Math.abs(dx) * (b.maxX - b.minX) + Math.abs(dy) * (b.maxY - b.minY)) * 0.3);
          const pos = [];
          const P = (x, y) => W3(x, y, plane.a * x + plane.b * y + plane.c + 0.35);
          const t = [cx + dx * L, cy + dy * L], s = [cx - dx * L, cy - dy * L];
          pos.push(...P(s[0], s[1]), ...P(t[0], t[1]));
          pos.push(...P(t[0], t[1]), ...P(t[0] - dx * 4 - dy * 3, t[1] - dy * 4 + dx * 3));
          pos.push(...P(t[0], t[1]), ...P(t[0] - dx * 4 + dy * 3, t[1] - dy * 4 - dx * 3));
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          const ls = new THREE.LineSegments(geo, mats.line('arrow'));
          ls.frustumCulled = false; ls.renderOrder = 5; ls.userData.plan = true;
          out.push(ls);
        }
      }
      /* core ids */
      const lvT = levels[levels.length - 1];
      if (lvT) for (const c of D.cores || []) out.push(tag(Overlays.label(c.id, (c.box.minX + c.box.maxX) / 2, (c.box.minY + c.box.maxY) / 2, lvT.z + lvT.ftf + 9.5, { height: 3.4, color: '#1d2733' })));
    }
    /* stall numbers: all levels or the isolated level */
    if (view.stallNumbers || view.level > 0) {
      const shown = view.level > 0 ? levels : view.stallNumbers ? levels : [];
      for (const lv of shown) {
        const tex = numberSheet(D, lv);
        if (tex) out.push(tex);
      }
    }
    return out;
  }
  /** One plane per level with every stall's number drawn on it. */
  function numberSheet(D, lv) {
    const b = D.box;
    if (!b || !(lv.stalls || []).length) return null;
    const ppf = Math.min(6, 4096 / Math.max(b.maxX - b.minX, b.maxY - b.minY));
    const cw = Math.ceil((b.maxX - b.minX) * ppf), ch = Math.ceil((b.maxY - b.minY) * ppf);
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1d2733';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(3 * ppf)}px system-ui, sans-serif`;
    for (const s of lv.stalls) {
      let sx = 0, sy = 0;
      for (const q of s.outer) { sx += q[0]; sy += q[1]; }
      sx /= s.outer.length; sy /= s.outer.length;
      const label = String(s.id).split('-').pop();
      const px = (sx - b.minX) * ppf, py = (b.maxY - sy) * ppf;
      ctx.save(); ctx.translate(px, py); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxY - b.minY);
    geo.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
    geo.applyMatrix4(planMatrix(lv.z + 0.2));
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.userData.ownMat = true; mesh.userData.label = `stall numbers level ${lv.index}`;
    return mesh;
  }

  /** The lane an entry cuts: ring (layout frame), center, and the direction of travel into the deck. */
  function entryLane(D, state, en) {
    const f = D.frame;
    if (!f) return null;
    const Wd = f.W, Dd = f.D, p = num(state.footprint.perimeter, 1);
    const len = Math.max(num(state.bays.turnZone, num(state.bays.aisle, 24)), 24);
    const w = num(en.width, 24), at = num(en.at, 0);
    let ring, center, dir;
    switch (en.side) {
      case 'east': ring = [[Wd - p - len, at - w / 2], [Wd, at - w / 2], [Wd, at + w / 2], [Wd - p - len, at + w / 2]]; center = [Wd - len / 2, at]; dir = [-1, 0]; break;
      case 'south': ring = [[at - w / 2, 0], [at + w / 2, 0], [at + w / 2, p + len], [at - w / 2, p + len]]; center = [at, len / 2]; dir = [0, 1]; break;
      case 'north': ring = [[at - w / 2, Dd - p - len], [at + w / 2, Dd - p - len], [at + w / 2, Dd], [at - w / 2, Dd]]; center = [at, Dd - len / 2]; dir = [0, -1]; break;
      default: ring = [[0, at - w / 2], [p + len, at - w / 2], [p + len, at + w / 2], [0, at + w / 2]]; center = [len / 2, at]; dir = [1, 0];
    }
    return { ring, center, dir };
  }

  return { build, heightFn, levelPieces, rampPlane, rampBox, entryLane, BAND_TYPES };
})();
