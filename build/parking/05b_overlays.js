/* ==========================================================================
   OVERLAYS  (flat text labels and lines laid on the deck)
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

  return { label, lines, loopPos };
})();
