/* ==========================================================================
   GROUND 3D
   Builds the three.js objects of a grading sketch from one Derived result (plan section 6):
     the proposed ground as one indexed mesh (the grid, refined 2x inside the work block), a skirt down to a base level,
     cut and fill colors (five steps each), the existing ground as a light wireframe where it differs, contours (proposed solid,
     existing dashed, majors heavier), the zero line, pad outlines and caps, one-story blocks on the tiers, walls (1 ft thick prisms
     from the low side to the top), routes (tubes colored per sample class), drive and lot outlines, the property line, slope
     conflict markers and the section line. The site neighbors, roads, water and trees are not drawn here: the shared site layer
     (SiteLayer in 06c_site.js) draws them with this mapper's exaggeration.
   Elevations are shifted by the base level (D.zBase) and scaled by the exaggeration; plan coordinates go through planToWorld.
   Everything the renderer owns (materials) is created here with userData.ownMat, so the renderer disposes it on rebuild.
   ========================================================================== */
const Ground3D = (() => {
  const css = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  const col = (hex) => new THREE.Color(hex);
  const SKIRT = '#b9bfc6';

  /** Color of a difference (proposed minus existing) on the cut and fill map: fill blue, cut red, five steps each. */
  function diffColor(diff) {
    const a = Math.abs(diff);
    if (a < CONFIG.noChange) return col(CONFIG.noChangeColor);
    let i = 0;
    while (i < CONFIG.diffEdges.length && a >= CONFIG.diffEdges[i]) i++;
    return col(diff > 0 ? CONFIG.fillColors[i] : CONFIG.cutColors[i]);
  }

  /** The (x, y, elevation) -> world point function for a derived result and a state (exaggeration included). */
  function mapper(D, state) {
    const ex = (state.view && state.view.exaggeration) || 1, zb = D.zBase;
    const Y = (e) => (e - zb) * ex;
    return { Y, W: (x, y, e) => planToWorld(x, y, Y(e)), V: (x, y, e) => new THREE.Vector3(...planToWorld(x, y, Y(e))), ex, zb };
  }

  /* ---- fat lines (LineSegments2): width in CSS pixels, the renderer sets the resolution each frame ---- */
  function fat(pos, hex, width, o = {}) {
    if (!pos.length) return null;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const op = o.opacity == null ? 1 : o.opacity;
    const mat = new LineMaterial({ color: col(hex).getHex(), linewidth: width, transparent: op < 1, opacity: op, depthWrite: false, depthTest: o.depthTest !== false, dashed: !!o.dashed, dashSize: o.dash || 4, gapSize: o.gap || 3 });
    const ls = new LineSegments2(geo, mat);
    if (o.dashed) ls.computeLineDistances();
    ls.renderOrder = o.order == null ? 5 : o.order; ls.frustumCulled = false; ls.userData.ownMat = true;
    return ls;
  }
  const loopPos = (out, ring, z, W) => { for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; out.push(...W(a[0], a[1], z), ...W(b[0], b[1], z)); } };
  /** A ring or a line sampled every `step` ft, each point at the elevation zAt(x, y). */
  function drape(out, pts, closed, step, zAt, W, lift = 0.15) {
    const n = pts.length, last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
      let q = null;
      for (let s = 0; s <= k; s++) {
        const f = s / k, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        const p = W(x, y, zAt(x, y) + lift);
        if (q) out.push(...q, ...p);
        q = p;
      }
    }
  }

  /* ---- the ground mesh ---------------------------------------------------------------------------------- */
  function groundObjects(D, state, M) {
    const b = D.built, g = b.grid, n = g.n, sp = g.spacing, pz = D.proposedZ, cutfill = state.view.style === 'cutfill';
    const fine = D.fine, blk = fine ? fine.block : null, nf = fine ? fine.n : 0;
    const nv = n * n + nf * nf;
    const pos = new Float32Array(nv * 3), colr = new Float32Array(nv * 3);
    const modelC = css('--scene-model', '#f6f6f3');
    const put = (k, x, y, z, e) => {
      pos[3 * k] = x; pos[3 * k + 1] = M.Y(z); pos[3 * k + 2] = -y;
      const c = cutfill ? diffColor(z - e) : modelC;
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
    geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 1.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.model = true; mesh.userData.ownMat = true; mesh.userData.ground = true; mesh.renderOrder = 0;
    const out = [mesh];

    // skirt: the four sides down to the base level (elevation zBase)
    const sk = [], skc = [];
    const top = (i, j) => M.Y(pz[j * n + i]);
    const sc = col(SKIRT);
    const quad = (x0, y0, t0, x1, y1, t1) => {
      sk.push(x0, t0, -y0, x1, t1, -y1, x1, 0, -y1, x0, t0, -y0, x1, 0, -y1, x0, 0, -y0);
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
    skirt.userData.model = true; skirt.userData.ownMat = true; skirt.userData.skirt = true;
    out.push(skirt);
    return out;
  }

  /** Light gray wireframe of the existing ground where it differs from the proposed ground. */
  function existingWire(D, M) {
    const g = D.built.grid, n = g.n, sp = g.spacing, pz = D.proposedZ, ez = g.z;
    const pos = [];
    const changed = (i, j) => {
      for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const k = (j + dj) * n + i + di; if (Math.abs(pz[k] - ez[k]) > 0.05) return true; }
      return false;
    };
    const P = (i, j) => M.W(g.x0 + i * sp, g.y0 + j * sp, ez[j * n + i]);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      if (!changed(i, j)) continue;
      pos.push(...P(i, j), ...P(i + 1, j), ...P(i, j), ...P(i, j + 1));
      if (i === n - 2 || !changed(i + 1, j)) pos.push(...P(i + 1, j), ...P(i + 1, j + 1));
      if (j === n - 2 || !changed(i, j + 1)) pos.push(...P(i, j + 1), ...P(i + 1, j + 1));
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: col(CONFIG.existingColor), transparent: true, opacity: 0.38, depthWrite: false }));
    ls.renderOrder = 3; ls.frustumCulled = false; ls.userData.ownMat = true; ls.userData.wire = true;
    return ls;
  }

  /* ---- contours ----------------------------------------------------------------------------------------- */
  const inRect = (x, y, r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && y >= r.y0 - 1e-6 && y <= r.y1 + 1e-6;
  function contourSegs(lines, rect, W, lift, keep) {
    const out = [];
    for (const L of lines) {
      if (!keep(L)) continue;
      for (let i = 0; i + 1 < L.line.length; i++) {
        const a = L.line[i], b = L.line[i + 1];
        if (rect && inRect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, rect)) continue;
        out.push(...W(a[0], a[1], L.z + lift), ...W(b[0], b[1], L.z + lift));
      }
    }
    return out;
  }
  function safeContours(grid, values, interval) {
    try { return ContoursMod.contours(grid, values, interval, { majorEvery: 5 }); } catch (e) { console.error(e); return []; }
  }
  /** The contour objects (proposed, existing, zero line) and their labels. */
  function contourObjects(D, state, M, overlay) {
    const v = state.view, ci = v.contours;
    const g = D.built.grid, n = g.n, sp = g.spacing;
    const gridLike = { spacing: sp, n, x0: g.x0, y0: g.y0 };
    const fine = D.fine;
    const fineLike = fine ? { spacing: fine.spacing, n: fine.n, x0: fine.x0, y0: fine.y0 } : null;
    const rect = fine ? { x0: fine.x0, y0: fine.y0, x1: fine.x0 + (fine.n - 1) * fine.spacing, y1: fine.y0 + (fine.n - 1) * fine.spacing } : null;
    const lift = 0.06;
    const interval = ci.interval === 2 ? 2 : 1;
    const labels = [];
    if (ci.on && ci.proposed) {
      const coarse = safeContours(gridLike, D.proposedZ, interval), fineL = fine ? safeContours(fineLike, fine.z, interval) : [];
      const lines = coarse.concat(fineL);
      // lines of the coarse set are clipped against the refined block; the refined lines are all kept
      const mk = (major) => contourSegs(coarse, rect, M.W, lift, (L) => L.major === major).concat(contourSegs(fineL, null, M.W, lift, (L) => L.major === major));
      const minor = fat(mk(false), '#3d4650', 1, { opacity: 0.45, order: 4 });
      const major = fat(mk(true), '#2b333b', 1.5, { opacity: 0.85, order: 4 });
      if (minor) { minor.userData.contour = 'proposed'; overlay.push(minor); }
      if (major) { major.userData.contour = 'proposed'; overlay.push(major); }
      // labels on the major lines: the longest piece of each level, at its middle, at most 14
      const best = new Map();
      const len = (line) => polyLength(line);
      for (const L of lines) {
        if (!L.major) continue;
        const l = len(L.line);
        if (l > 70 && (!best.has(L.z) || best.get(L.z).l < l)) best.set(L.z, { l, L });
      }
      for (const { L } of [...best.values()].sort((a, b) => b.l - a.l).slice(0, 14)) {
        const mid = L.line[Math.floor(L.line.length / 2)];
        labels.push({ text: Math.round(L.z).toLocaleString('en-US'), x: mid[0], y: mid[1], z: L.z });
      }
    }
    if (ci.on && ci.existing) {
      const lines = safeContours(gridLike, g.z, interval);
      const dashed = fat(contourSegs(lines, null, M.W, lift, () => true), CONFIG.existingColor, 1, { dashed: true, dash: 3, gap: 2.5, opacity: 0.9, order: 3 });
      if (dashed) { dashed.userData.contour = 'existing'; overlay.push(dashed); }
    }
    if (v.style === 'cutfill') {
      const diff = new Float64Array(n * n);
      for (let k = 0; k < n * n; k++) diff[k] = D.proposedZ[k] - g.z[k];
      let zl = [];
      try { zl = ZeroLineOf(gridLike, diff); } catch (e) { zl = []; }
      const pos = [];
      const addLine = (line, clip) => {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], b = line[i + 1];
          if (clip && rect && inRect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, rect)) continue;
          pos.push(...M.W(a[0], a[1], g.at(a[0], a[1]) + 0.2), ...M.W(b[0], b[1], g.at(b[0], b[1]) + 0.2));
        }
      };
      for (const line of zl) addLine(line, true);
      if (fine) {
        const fd = new Float64Array(fine.n * fine.n);
        for (let jb = 0; jb < fine.n; jb++) for (let ia = 0; ia < fine.n; ia++) fd[jb * fine.n + ia] = fine.z[jb * fine.n + ia] - D.built.existingAt(fine.x0 + ia * fine.spacing, fine.y0 + jb * fine.spacing);
        let zf = [];
        try { zf = ZeroLineOf(fineLike, fd); } catch (e) { zf = []; }
        for (const line of zf) addLine(line, false);
      }
      const z = fat(pos, '#1d242b', 2, { order: 6 });
      if (z) { z.userData.zeroLine = true; overlay.push(z); }
    }
    return labels;
  }
  const ZeroLineOf = (grid, diff) => ContoursMod.zeroLine(grid, diff);

  /* ---- pads, buildings ------------------------------------------------------------------------------------- */
  function padObjects(D, state, M, model, overlay) {
    const cutfill = state.view.style === 'cutfill';
    const modelC = css('--scene-model', '#f6f6f3');
    const edge = css('--scene-edge', '#20262d');
    const pos = [];
    for (const t of D.built.tiers) {
      for (const ring of t.pads || []) loopPos(pos, ring, t.padTop + 0.1, M.W);
      // thin cap in Model style so the pad edge is crisp whatever the grid does
      if (!cutfill) {
        for (const ring of t.pads || []) {
          try {
            const shape = new THREE.Shape(ring.map((q) => new THREE.Vector2(q[0], q[1])));
            const geo = new THREE.ShapeGeometry(shape);
            geo.deleteAttribute('uv');
            geo.applyMatrix4(planMatrix(M.Y(t.padTop) + 0.03));
            const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: modelC, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
            m.userData.model = true; m.userData.ownMat = true; m.userData.padCap = t.id; m.userData.pick = { kind: 'building', id: t.building };
            model.push(m);
          } catch (e) { /* a degenerate ring draws no cap */ }
        }
      }
    }
    const lines = fat(pos, CONFIG.padColor, 2, { order: 6 });
    if (lines) { lines.userData.pads = true; overlay.push(lines); }

    // one-story blocks at each tier, for scale
    const mass = new THREE.MeshStandardMaterial({ color: modelC, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const edgeMat = new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.55 });
    for (const t of D.built.tiers) {
      for (const ring of t.outers || (t.outer && t.outer.length ? [t.outer] : [])) {
        try {
          const shape = new THREE.Shape(ring.map((q) => new THREE.Vector2(q[0], q[1])));
          const depth = Math.max(0.2, (t.ffe - t.padTop + CONFIG.buildingHeight) * M.ex);
          const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
          geo.deleteAttribute('uv');
          geo.applyMatrix4(planMatrix(M.Y(t.padTop)));
          const mesh = new THREE.Mesh(geo, mass);
          mesh.userData.model = true; mesh.userData.pick = { kind: 'building', id: t.building }; mesh.userData.block = t.id;
          model.push(mesh);
          const eg = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
          eg.userData.edges = true; eg.renderOrder = 2;
          model.push(eg);
        } catch (e) { /* skip a bad ring */ }
      }
    }
    // the blocks share one material and one edge material: the first block owns them for disposal
    const first = model.find((o) => o.userData.block);
    if (first) first.userData.ownMat = true;
    const firstEdge = model.find((o) => o.userData.edges);
    if (firstEdge) firstEdge.userData.ownMat = true;
  }

  /* ---- walls ------------------------------------------------------------------------------------------------ */
  const MIN_WALL_H = 0.1;
  function wallGeometry(rec, M) {
    const s = rec.profile.samples, line = rec.line;
    const pos = [];
    const addQuad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const bySeg = new Map();
    s.forEach((p, i) => { if (!bySeg.has(p.seg)) bySeg.set(p.seg, []); bySeg.get(p.seg).push(i); });
    let prev = -1;
    for (const seg of [...bySeg.keys()].sort((a, b) => a - b)) {
      const idx = bySeg.get(seg).slice();
      if (prev >= 0) idx.unshift(prev);
      prev = idx[idx.length - 1];
      const a = line[seg], b = line[seg + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(L > 0) || idx.length < 2) continue;
      const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, nx = -ty, ny = tx, hw = 0.5;
      const sec = idx.map((i) => {
        const p = s[i], top = p.top, bot = Math.min(p.bottom, p.top - 0.2);
        const l = (e) => M.W(p.x + nx * hw, p.y + ny * hw, e), r = (e) => M.W(p.x - nx * hw, p.y - ny * hw, e);
        return { lb: l(bot), rb: r(bot), rt: r(top), lt: l(top) };
      });
      for (let k = 0; k + 1 < sec.length; k++) {
        const A = sec[k], B = sec[k + 1];
        addQuad(A.lb, B.lb, B.rb, A.rb);             // bottom
        addQuad(A.lt, A.rt, B.rt, B.lt);             // top
        addQuad(A.lb, A.lt, B.lt, B.lb);             // left side
        addQuad(A.rb, B.rb, B.rt, A.rt);             // right side
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
  function wallObjects(D, state, M, model, overlay, labels) {
    let recs = [];
    try { recs = GradDerivedMod.wallRecords(state, D.built); } catch (e) { console.error(e); }
    const flag = state.limits.wallFlag;
    const mats = {};
    const matOf = (key, hex, extra = {}) => mats[key] || (mats[key] = new THREE.MeshStandardMaterial({ color: col(hex), roughness: 0.9, side: THREE.DoubleSide, ...extra }));
    for (const rec of recs) {
      if (rec.heightMax < MIN_WALL_H || rec.profile.samples.length < 2) continue;
      const flagged = rec.heightMax > flag + 1e-9;
      const loose = rec.auto && !rec.accepted;
      let m;
      if (loose) m = matOf('loose', CONFIG.wallColor, { transparent: true, opacity: 0.4, depthWrite: false });
      else if (flagged) m = matOf('flag', CONFIG.wallFlagColor);
      else if (rec.kind === 'pad-step') m = matOf('step', CONFIG.wallStepColor);
      else m = matOf('wall', CONFIG.wallColor);
      const mesh = new THREE.Mesh(wallGeometry(rec, M), m);
      mesh.userData.model = true; mesh.userData.pick = { kind: 'wall', id: rec.id }; mesh.userData.wallKind = rec.kind;
      if (loose) mesh.castShadow = false;
      model.push(mesh);
      // top line
      const pos = [];
      const tl = rec.top;
      for (let i = 0; i + 1 < tl.length; i++) pos.push(...M.W(tl[i][0], tl[i][1], tl[i][2] + 0.05), ...M.W(tl[i + 1][0], tl[i + 1][1], tl[i + 1][2] + 0.05));
      const ln = fat(pos, flagged ? CONFIG.wallFlagColor : '#2a3139', 2, { dashed: loose, dash: 3, gap: 2, order: 6 });
      if (ln) { ln.userData.wallTop = rec.id; overlay.push(ln); }
      // label at the tallest point
      const im = rec.profile.samples[rec.profile.iMax];
      if (im && rec.heightMax >= 0.5) labels.push({ text: `${rec.heightMax.toFixed(1)} ft`, x: im.x, y: im.y, z: im.top, color: flagged ? '#b24a0a' : '#1d2733', id: `wall-${rec.id}` });
    }
    for (const mat of new Set(model.filter((o) => o.userData.wallKind).map((o) => o.material))) { const o = model.find((x) => x.material === mat); if (o) o.userData.ownMat = true; }
  }

  /* ---- routes, drives, lots, property, conflicts, section ----------------------------------------------- */
  function routeObjects(D, state, M, overlay, labels) {
    const limits = state.limits;
    for (const r of state.routes) {
      if (!r.line || r.line.length < 2) continue;
      let prof;
      try { prof = RoutesMod.routeProfile(r, D.built.surface.at, limits); } catch (e) { continue; }
      const S = prof.samples;
      if (S.length < 2) continue;
      let i = 0;
      while (i < S.length - 1) {
        const cls = S[i].cls;
        let j = i + 1;
        while (j < S.length - 1 && S[j].cls === cls) j++;
        const pts = S.slice(i, j + 1).map((p) => M.V(p.x, p.y, p.z + 0.7));
        if (pts.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
          const geo = new THREE.TubeGeometry(curve, Math.max(2, pts.length), 0.55, 6, false);
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(CONFIG.classColors[cls] || CONFIG.routeColor), roughness: 0.6 }));
          mesh.userData.ownMat = true; mesh.userData.route = r.id; mesh.userData.pick = { kind: 'route', id: r.id }; mesh.renderOrder = 7;
          overlay.push(mesh);
        }
        i = j;
      }
      const a = S[0], z = S[S.length - 1];
      for (const p of [a, z]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshStandardMaterial({ color: col('#1d2733'), roughness: 0.7 }));
        dot.position.copy(M.V(p.x, p.y, p.z + 0.7)); dot.userData.ownMat = true; dot.renderOrder = 7;
        overlay.push(dot);
      }
      const mid = S[Math.floor(S.length / 2)];
      labels.push({ text: `${r.name}\n${(prof.maxSlope * 100).toFixed(1)}% max`, x: mid.x, y: mid.y, z: mid.z + 1.2, color: prof.kind === 'walk' ? '#1f7a44' : '#8a5a00', id: `route-${r.id}` });
    }
  }

  function outlineObjects(D, state, M, overlay) {
    const at = D.built.surface.at;
    const driveP = [], lotP = [], centerP = [];
    for (const f of D.built.features) {
      if (f.kind === 'drive') drape(driveP, f.ring, true, 4, (x, y) => at(x, y), M.W, 0.2);
      if (f.kind === 'lot') drape(lotP, f.ring, true, 4, (x, y) => at(x, y), M.W, 0.2);
    }
    for (const dv of state.drives) if (dv.line && dv.line.length >= 2) drape(centerP, dv.line, false, 4, (x, y) => at(x, y), M.W, 0.25);
    const a = fat(driveP, CONFIG.driveColor, 2, { order: 6 }); if (a) { a.userData.drives = true; overlay.push(a); }
    const c = fat(centerP, CONFIG.driveColor, 1, { dashed: true, dash: 5, gap: 4, order: 6 }); if (c) { c.userData.drives = true; overlay.push(c); }
    const l = fat(lotP, CONFIG.lotColor, 2, { dashed: true, dash: 6, gap: 3, order: 6 }); if (l) { l.userData.lots = true; overlay.push(l); }
    const prop = D.built.property;
    if (prop && prop.length >= 3 && state.property.mode === 'drawn') {
      const pp = [];
      drape(pp, prop, true, 8, (x, y) => at(x, y), M.W, 0.3);
      const pl = fat(pp, CONFIG.propertyColor, 2, { dashed: true, dash: 8, gap: 4, order: 6 });
      if (pl) { pl.userData.property = true; overlay.push(pl); }
    }
    for (const c2 of D.built.conflicts || []) {
      const p0 = M.V(c2.x, c2.y, at(c2.x, c2.y)), p1 = M.V(c2.x, c2.y, at(c2.x, c2.y) + 25 / M.ex);
      const geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
      const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col(CONFIG.conflictColor), depthWrite: false }));
      ln.userData.ownMat = true; ln.userData.conflict = true; ln.renderOrder = 8;
      overlay.push(ln);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 12), new THREE.MeshStandardMaterial({ color: col(CONFIG.conflictColor), roughness: 0.6 }));
      cone.position.copy(p1); cone.rotation.x = Math.PI; cone.userData.ownMat = true; cone.renderOrder = 8;
      overlay.push(cone);
    }
    const sec = state.view.section;
    if (sec && sec.length === 2) {
      const sp = [];
      drape(sp, sec, false, 3, (x, y) => at(x, y), M.W, 0.5);
      const sl = fat(sp, '#d03a30', 2, { dashed: true, dash: 6, gap: 3, order: 8 });
      if (sl) { sl.userData.sectionLine = true; overlay.push(sl); }
    }
  }

  function tierLabels(D, state, labels) {
    for (const t of D.built.tiers) {
      const ring = t.pad && t.pad.length ? t.pad : t.outer;
      if (!ring || ring.length < 3) continue;
      const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      labels.push({ text: `FFE ${Units.formatElev(t.ffe)}`, x: c[0], y: c[1], z: t.ffe + CONFIG.buildingHeight + 0.5, color: '#16427a', id: `tier-${t.id}` });
    }
    const sec = state.view.section;
    if (sec && sec.length === 2) {
      const at = D.built.surface.at;
      labels.push({ text: 'A', x: sec[0][0], y: sec[0][1], z: at(sec[0][0], sec[0][1]) + 6, color: '#b52f27', id: 'sec-a', height: 8 });
      labels.push({ text: 'B', x: sec[1][0], y: sec[1][1], z: at(sec[1][0], sec[1][1]) + 6, color: '#b52f27', id: 'sec-b', height: 8 });
    }
  }

  /* ---- build ---------------------------------------------------------------------------------------------- */
  /** → { model: [...], overlay: [...] }. model objects cast and receive shadows; overlay objects are lines, tubes and flat labels. */
  function build(D, state, disp, opts = {}) {
    const M = mapper(D, state);
    const model = [], overlay = [], labels = [];
    const clean = !!opts.clean;
    try { model.push(...groundObjects(D, state, M)); } catch (e) { console.error(e); }
    if (clean) { padObjects(D, state, M, model, []); wallObjects(D, state, M, model, [], []); return { model, overlay }; }
    if (state.view.contours.on && state.view.contours.existing || state.view.style === 'cutfill') {
      const w = existingWire(D, M);
      if (w) overlay.push(w);
    }
    const cl = contourObjects(D, state, M, overlay);
    for (const L of cl) labels.push({ ...L, id: `c-${L.text}-${Math.round(L.x)}`, color: '#1d242b', height: 3.2, small: true });
    padObjects(D, state, M, model, overlay);
    wallObjects(D, state, M, model, overlay, labels);
    routeObjects(D, state, M, overlay, labels);
    outlineObjects(D, state, M, overlay);
    tierLabels(D, state, labels);
    // Labels are flat text in feet: they grow with the framed work so they stay readable in plan.
    const ub = D.bounds.union, unit = clamp(Math.max(ub.maxX - ub.minX, ub.maxY - ub.minY) / 300, 1, 2.6);
    for (const L of labels) {
      const lab = Overlays.label(L.text, L.x, L.y, M.Y(L.z) + 0.3, { height: (L.height || 4.5) * unit, color: L.color || '#1d2733' });
      lab.userData.plan = true; lab.userData.labelId = L.id;
      overlay.push(lab);
    }
    return { model, overlay };
  }

  return { build, mapper, diffColor, fat };
})();
