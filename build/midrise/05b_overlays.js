/* ==========================================================================
   OVERLAYS  (plan section 6, "Plan overlays")
   Lines and flat text labels the renderer adds on top of the massing.
     ground  always on: open courts, the drawn surface lot, the project boundary and the north arrow
     plan    plan view and Diagram style: dashed spines, unit ticks, hatched corner zones, courtyard labels,
             stall counts on the deck and the podium, podium outline, the lot count, stair and elevator seeds
   Objects are plain three.js lines and meshes. Each one owns its material (userData.ownMat), so the renderer
   disposes it when the layer is rebuilt. Text is drawn into a canvas and laid flat on a plane that has a size in feet,
   so it stays readable in plan and shrinks with distance in the axon view.
   ========================================================================== */
const Overlays = (() => {
  const rootCss = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return new THREE.Color(v || fb); };
  const W = (p, z) => planToWorld(p[0], p[1], z);
  const fmtN = (n) => Math.round(n).toLocaleString('en-US');
  const SEED_COLORS = { stair: '#d9731a', 'exterior-stair': '#d9a22b', elevator: '#7a5cc2' };

  function lines(pos, { color, opacity = 1, dashed = false, order = 4, dash = 4, gap = 3 }) {
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: opacity < 1, opacity, dashSize: dash, gapSize: gap, depthWrite: false })
      : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false });
    const ls = new THREE.LineSegments(geo, mat);
    ls.renderOrder = order; ls.frustumCulled = false; ls.userData.ownMat = true;
    if (dashed) ls.computeLineDistances();
    return ls;
  }
  const loopPos = (pos, ring, z) => { for (let i = 0; i < ring.length; i++) pos.push(...W(ring[i], z), ...W(ring[(i + 1) % ring.length], z)); };

  /** Text lying flat on the plan at (x, y, z). `height` is the height of one line of text in feet. */
  function label(text, x, y, z, { height = 5, color = '#1d2733', halo = '#ffffff' } = {}) {
    const rows = String(text).split('\n');
    const px = 48, pad = 12;
    const cv = document.createElement('canvas');
    const ctx0 = cv.getContext('2d');
    ctx0.font = `600 ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const widest = Math.max(...rows.map((r) => ctx0.measureText(r).width));
    cv.width = Math.ceil(widest + pad * 2); cv.height = Math.ceil(rows.length * px * 1.2 + pad * 2);
    const ctx = cv.getContext('2d');
    ctx.font = `600 ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    rows.forEach((r, i) => {
      const yy = pad + px * 0.6 + i * px * 1.2;
      ctx.lineWidth = 9; ctx.strokeStyle = halo; ctx.strokeText(r, cv.width / 2, yy);
      ctx.fillStyle = color; ctx.fillText(r, cv.width / 2, yy);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const hh = height * rows.length * 1.2 + (height * 2 * pad) / px, ww = (hh * cv.width) / cv.height;
    const geo = new THREE.PlaneGeometry(ww, hh);
    geo.translate(x, y, 0);
    geo.applyMatrix4(planMatrix(z));
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.userData.ownMat = true; mesh.userData.label = text;
    return mesh;
  }

  /** Diagonal hatch lines clipped to a ring: [[a, b], …] with a, b = [x, y]. */
  function hatch(ring, spacing = 4, angDeg = 45) {
    const a = (angDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const rot = ring.map((p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]);       // hatch lines become horizontal
    let y0 = Infinity, y1 = -Infinity;
    for (const p of rot) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const out = [];
    for (let y = Math.ceil(y0 / spacing) * spacing + spacing / 2; y < y1; y += spacing) {
      const xs = [];
      for (let i = 0; i < rot.length; i++) {
        const p = rot[i], q = rot[(i + 1) % rot.length];
        if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const back = (x) => [x * c - y * s, x * s + y * c];
        out.push([back(xs[i]), back(xs[i + 1])]);
      }
    }
    return out;
  }

  const centroid = (ring) => {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], k = p[0] * q[1] - q[0] * p[1];
      A += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
    }
    if (Math.abs(A) < 1e-9) { const n = ring.length || 1; return [ring.reduce((t, p) => t + p[0], 0) / n, ring.reduce((t, p) => t + p[1], 0) / n]; }
    return [cx / (3 * A), cy / (3 * A)];
  };

  /** Where the unit modules of a bar start: stations every `w` along the bar from its start. → [{ x, y, nx, ny }] (nx, ny = left normal) */
  function stations(bar, w) {
    const legs = BarsMod.legsOf(bar);
    const out = [];
    let cum = 0, li = 0;
    for (let s = w; s < bar.length - 1e-6; s += w) {
      while (li < legs.length - 1 && s >= cum + legs[li].length - 1e-9) { cum += legs[li].length; li++; }
      const leg = legs[li], t = s - cum, a = (leg.angle * Math.PI) / 180;
      out.push({ x: leg.x0 + t * Math.cos(a), y: leg.y0 + t * Math.sin(a), nx: -Math.sin(a), ny: Math.cos(a) });
    }
    return out;
  }
  /** Offsets across the bar (from its centerline, left positive) where the unit zones start and end: [[from, to], …]. */
  function unitZones(bar, rules) {
    const half = bar.depth / 2;
    if (bar.corridor === 'single') {
      const cw = Math.min(rules.corridorWidth, bar.depth);
      return bar.unitSide === 'right' ? [[-half, half - cw]] : [[-half + cw, half]];
    }
    const cw = Math.min(bar.corridor === 'breezeway' ? rules.breezewayWidth : rules.corridorWidth, bar.depth);
    return [[cw / 2, half], [-half, -cw / 2]];
  }

  /** The roof elevation of a bar (top of its highest level), or null. */
  function roofOf(built, barId) {
    let top = null;
    for (const l of built.levels) if (l.zone === 'bar' && (l.barIds || []).includes(barId)) top = Math.max(top === null ? -Infinity : top, l.z + l.ftf);
    return top;
  }

  function build(state, d, { projectBoundary = null } = {}) {
    const ground = [], plan = [];
    const push = (list, o) => { if (o) list.push(o); };
    const accent = rootCss('--accent', '#23508f');
    const view = state.view;
    const built = d.built;
    const courtGreen = new THREE.Color('#3f8f4a');
    const m = d.metrics;

    /* ---- ground: open courts, the drawn lot, the project boundary, the north arrow ---- */
    {
      const pos = [];
      for (const c of state.courts || []) loopPos(pos, rectRingAt(num(c.x, 0), num(c.y, 0), num(c.w, 0), num(c.d, 0)), 0.3);
      push(ground, lines(pos, { color: courtGreen, order: 4 }));
      const lot = state.surface && state.surface.lot;
      if (Array.isArray(lot) && lot.length >= 3) {
        const lp = [];
        loopPos(lp, lot, 0.3);
        push(ground, lines(lp, { color: new THREE.Color('#7a8fa6'), order: 4 }));
      }
      if (projectBoundary && projectBoundary.length >= 3) {
        const bp = [];
        loopPos(bp, projectBoundary, 0.2);
        push(ground, lines(bp, { color: new THREE.Color('#c0701a'), dashed: true, dash: 12, gap: 8, order: 3 }));
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const q of projectBoundary) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
        // north arrow: a shaft and a head, just beyond the north-east corner of the site, with an N beside it
        const ax = maxX + 25, ay = maxY - 30, np = [];
        const seg = (a, b) => np.push(...W(a, 0.3), ...W(b, 0.3));
        seg([ax, ay], [ax, ay + 40]); seg([ax, ay + 40], [ax - 7, ay + 26]); seg([ax, ay + 40], [ax + 7, ay + 26]);
        push(ground, lines(np, { color: new THREE.Color('#1d2733'), order: 4 }));
        push(ground, label('N', ax, ay + 52, 0.3, { height: 9 }));
      }
    }

    /* ---- plan: spines ---- */
    {
      const pos = [];
      for (const e of built.spineGraph.edges || []) {
        const z = roofOf(built, e.barId);
        const pts = e.points || [];
        if (z === null || pts.length < 2) continue;
        for (let i = 0; i + 1 < pts.length; i++) pos.push(...W(pts[i], z + 0.25), ...W(pts[i + 1], z + 0.25));
      }
      push(plan, lines(pos, { color: accent, dashed: true, order: 5 }));
    }

    /* ---- plan: unit ticks ---- */
    if (view.ticks) {
      const pos = [];
      for (const bar of state.bars) {
        const prog = state.programs[bar.program] || {};
        const w = num(bar.unitWidth, 0) > 0 ? bar.unitWidth : num(prog.unitWidth, 0);
        const z = roofOf(built, bar.id);
        if (!(w > 0) || z === null || !(bar.length > 0)) continue;
        const zones = unitZones(bar, state.rules);
        for (const st of stations(bar, w)) {
          for (const [from, to] of zones) {
            pos.push(...W([st.x + st.nx * from, st.y + st.ny * from], z + 0.25), ...W([st.x + st.nx * to, st.y + st.ny * to], z + 0.25));
          }
        }
      }
      push(plan, lines(pos, { color: new THREE.Color('#5d6b7a'), opacity: 0.85, order: 5 }));
    }

    /* ---- plan: corner zones, hatched ---- */
    {
      const pos = [];
      for (const j of built.joints || []) {
        const za = roofOf(built, j.barIds[0]), zb = roofOf(built, j.barIds[1]);
        if (za === null || zb === null) continue;
        const z = Math.max(za, zb) + 0.3;
        for (const [a, b] of hatch(j.zone.outer, 4, 45)) pos.push(...W(a, z), ...W(b, z));
        loopPos(pos, j.zone.outer, z);
      }
      push(plan, lines(pos, { color: new THREE.Color('#c0701a'), opacity: 0.9, order: 5 }));
    }

    /* ---- plan: courtyard labels ---- */
    {
      const cmin = num(state.site.courtyardMin, 0);
      for (const c of built.courtyards || []) {
        const [cx, cy] = centroid(c.ring);
        const bad = cmin > 0 && c.minDim < cmin - 1e-6;
        const name = c.kind === 'closed' ? `Courtyard ${c.id}` : `Court ${c.id}`;
        push(plan, label(`${name}\n${fmtN(c.area)} sf · ${Units.formatFeetInches(c.minDim)} min`, cx, cy, 0.4, { height: 4.5, color: bad ? '#b3261e' : '#1d2733' }));
      }
    }

    /* ---- plan: stall counts, podium outline, the lot ---- */
    {
      const det = (m.parking && m.parking.providedDetail) || null;
      if (state.deck && state.deck.on && det) {
        const top = built.levels.filter((l) => l.zone === 'deck').reduce((t, l) => Math.max(t, l.z + l.ftf), 0);
        push(plan, label(`Deck · ${fmtN(det.deck)} stalls`, num(state.deck.x, 0), num(state.deck.y, 0), top + 0.4, { height: 6 }));
      }
      const podLv = built.levels.filter((l) => l.zone === 'podium');
      if (podLv.length) {
        const topLv = podLv[podLv.length - 1], z = topLv.z + topLv.ftf + 0.3;
        const pos = [];
        for (const poly of topLv.plates) loopPos(pos, poly.outer, z);
        push(plan, lines(pos, { color: accent, order: 5 }));
        const box = boxOfPolys(topLv.plates);
        const stalls = det ? (det.podium || []).reduce((t, n) => t + n, 0) : 0;
        if (box && stalls > 0) push(plan, label(`Podium · ${fmtN(stalls)} stalls`, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, z + 0.1, { height: 6 }));
      }
      const lot = state.surface && state.surface.lot;
      if (Array.isArray(lot) && lot.length >= 3 && det) {
        const [cx, cy] = centroid(lot);
        push(plan, label(`Lot · ${fmtN(det.lot)} stalls`, cx, cy, 0.5, { height: 5 }));
      }
    }

    /* ---- plan: stair and elevator seeds ---- */
    try {
      const seeds = MidDerivedMod.seedBlocks(state, built, d.metrics.units);
      const barLv = built.levels.filter((l) => l.zone === 'bar');
      const keyOf = (b) => `${b.kind}|${JSON.stringify(b.outer)}`;
      const byKind = {};
      barLv.forEach((l, i) => {
        const next = new Set(((seeds[barLv[i + 1] && barLv[i + 1].index]) || []).map(keyOf));
        for (const b of seeds[l.index] || []) {
          if (next.has(keyOf(b))) continue;                 // the same block stands on the level above: draw it there only
          const z = l.z + l.ftf + 0.35;
          const arr = byKind[b.kind] || (byKind[b.kind] = []);
          loopPos(arr, b.outer, z);
          arr.push(...W(b.outer[0], z), ...W(b.outer[2], z), ...W(b.outer[1], z), ...W(b.outer[3], z));
        }
      });
      for (const [kind, pos] of Object.entries(byKind)) push(plan, lines(pos, { color: new THREE.Color(SEED_COLORS[kind] || '#d9731a'), order: 6 }));
    } catch (e) { console.error(e); }

    return { ground, plan };
  }

  return { build, hatch, stations, unitZones, label, centroid };
})();
