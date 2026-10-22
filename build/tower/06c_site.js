/* ==========================================================================
   SITE LAYER  (docs/tower-project-sun-plan.md sections 4.1 and 6.1)
   `SiteLayer` draws the project site boundary under the tower when a project with a site is open
   (in the tower local frame, ProjectMod.transformRing(placement, boundary, "toLocal"), given by ProjectUI.boundaryLocal()).
   Neighbor buildings come in as context blocks through Context from site, so the context layer already draws them.
   The boundary is a dashed orange loop just above the ground, with a north arrow beside its north-east corner. The arrow
   turns with the placement rotation, so it always points to project north. Both follow "Show site boundary and neighbors"
   (state.context.show).
   ========================================================================== */
const SiteLayer = (() => {
  let drawn = { shown: false, points: 0, rotation: 0 };
  let dashed = null, solid = null;

  const materials = () => {
    if (!dashed) {
      dashed = new THREE.LineDashedMaterial({ color: 0xc0701a, dashSize: 12, gapSize: 8 });
      solid = new THREE.LineBasicMaterial({ color: 0x1d2733 });
    }
    return { dashed, solid };
  };

  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key } (a THREE.Group already in the scene, hidden in Compare and in the AI-ready image);
   *  state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, materialFor, lineMaterial }.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) {
    const ring = ProjectUI.has() && state.context && state.context.show ? ProjectUI.boundaryLocal() : null;
    const on = !!ring && ring.length >= 3;
    const rot = on ? ProjectUI.placement().rotation : 0;
    const key = on ? `b|${ProjectUI.boundaryKey()}` : 'off';
    return kit.syncLayer(layer, key, () => {
      drawn = { shown: on, points: on ? ring.length : 0, rotation: rot };
      if (!on) return [];
      const mats = materials();
      const out = [];
      const loop = new THREE.BufferGeometry().setFromPoints(ring.map((q) => worldVec(q[0], q[1], 0.2)));
      const line = new THREE.LineLoop(loop, mats.dashed);
      line.computeLineDistances();
      out.push(line);

      // north arrow: project north in the local frame is (sin r, cos r); a shaft, a head and an N, flat on the ground
      const r = (rot * Math.PI) / 180, nx = Math.sin(r), ny = Math.cos(r), ex = ny, ey = -nx;     // north and east unit vectors
      let maxX = -Infinity, maxY = -Infinity, minX = Infinity, minY = Infinity;
      for (const q of ring) { maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]); minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); }
      const span = Math.max(maxX - minX, maxY - minY, 1);
      const k = Math.max(0.5, Math.min(4, span / 1000));                                         // scales with the site, 1 at 1,000 ft
      let best = null;                                                                           // the boundary corner farthest toward north-east
      for (const q of ring) { const s = q[0] * (ex + nx) + q[1] * (ey + ny); if (!best || s > best.s) best = { s, q }; }
      const base = [best.q[0] + (ex - nx) * 30 * k, best.q[1] + (ey - ny) * 30 * k];
      const P = (a, b) => [base[0] + ex * a * k + nx * b * k, base[1] + ey * a * k + ny * b * k];   // a = east, b = north
      const pts = [];
      const seg = (p, q) => { pts.push(worldVec(p[0], p[1], 0.2), worldVec(q[0], q[1], 0.2)); };
      seg(P(0, 0), P(0, 40)); seg(P(0, 40), P(-7, 26)); seg(P(0, 40), P(7, 26));
      seg(P(-6, 50), P(-6, 68)); seg(P(-6, 68), P(6, 50)); seg(P(6, 50), P(6, 68));              // the letter N
      out.push(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mats.solid));
      return out;
    });
  }
  /** For tests: what is drawn. */
  function info() { return { ...drawn }; }
  return { update, info };
})();
