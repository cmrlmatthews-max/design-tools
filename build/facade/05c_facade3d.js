/* ==========================================================================
   FACADE 3D
   Builds the three.js objects of a facade from one Derived result (plan section 6):
     a thin wall box per face and level (0.5 ft), glass boxes (pale blue-gray, 45 to 60 percent), spandrel and solid boxes in the
     zone material, mullions, fins, shades, balconies (slabs and rails, or the dark recess of an inset balcony), a thin roof cap per level.
   Every element of a face and level comes from ElevMod.faceElements(state, face), the same function the elevations DXF and the SketchUp
   export use, so the screen, the elevation and the files agree. Instanced meshes: one each for opaque, glass and mullion boxes.
   Everything is authored in the massing (local) frame, in plan feet, through planToWorld; the face a to b runs along the u axis and
   the outward normal is (dy, -dx) / |d| (the rule of faces.js). Draft quality (a drag in progress) skips mullions and fins.
   Materials come from the renderer: mats.mesh(key), mats.line(key).
   ========================================================================== */
const Facade3D = (() => {
  const W3 = (x, y, e) => planToWorld(x, y, e);
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  UNIT.deleteAttribute('uv');
  const tmp = new THREE.Matrix4();
  const vX = new THREE.Vector3(), vY = new THREE.Vector3(0, 1, 0), vZ = new THREE.Vector3(), vS = new THREE.Vector3();

  /** A set of instances: matrices, colors and the owning face group of each (for picking). */
  class Buf {
    constructor() { this.m = []; this.c = []; this.owner = []; }
    get n() { return this.owner.length; }
    /** A box on a face: u0..u1 along the face from a, v0..v1 up from the floor, d0..d1 along the outward normal from the face line. */
    box(face, u0, u1, v0, v1, d0, d1, color, owner) {
      const a = face.a, b = face.b;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
      const nx = dy, ny = -dx;
      const uc = (u0 + u1) / 2, dc = (d0 + d1) / 2, vc = (v0 + v1) / 2;
      const px = a[0] + dx * uc + nx * dc, py = a[1] + dy * uc + ny * dc, pz = (face.z || 0) + vc;
      vX.set(dx, 0, -dy); vZ.set(nx, 0, -ny);
      tmp.makeBasis(vX, vY, vZ);
      tmp.scale(vS.set(Math.max(0.02, u1 - u0), Math.max(0.02, v1 - v0), Math.max(0.02, d1 - d0)));
      tmp.setPosition(px, pz, -py);
      for (let i = 0; i < 16; i++) this.m.push(tmp.elements[i]);
      this.c.push(color.r, color.g, color.b);
      this.owner.push(owner);
    }
    mesh(material, { cast = false, order = 0 } = {}) {
      if (!this.n) return null;
      const im = new THREE.InstancedMesh(UNIT.clone(), material, this.n);
      im.instanceMatrix.array.set(this.m);
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
      im.castShadow = cast; im.receiveShadow = true; im.renderOrder = order; im.frustumCulled = false;
      im.userData.model = true; im.userData.owners = this.owner;
      im.computeBoundingSphere();
      return im;
    }
  }

  const cssModel = () => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--scene-model').trim() || '#f6f6f3');

  /** Plan extrusion of polygons (outer + holes) from z, `depth` ft up. */
  function extrude(polys, z, depth) {
    const shapes = polys.map((poly) => {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q[0], q[1])));
      for (const h of poly.holes || []) shape.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
      return shape;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(0.05, depth), bevelEnabled: false, steps: 1, curveSegments: 1 });
    geo.deleteAttribute('uv');
    geo.applyMatrix4(planMatrix(z));
    return geo;
  }

  const bandMaterial = (state, face) => {
    let m = face.rule && face.rule.material ? face.rule.material : null;
    for (const b of state.bands || []) {
      if (b.zone !== undefined && b.zone === face.zone) m = b.material;
      else if (b.every !== undefined && b.every > 0 && face.levelIndex % b.every === 0) m = b.material;
    }
    return m;
  };

  /** The WWR step color of a ratio (five steps, light to dark). */
  function wwrColor(r) {
    let i = 0;
    while (i < CONFIG.wwrEdges.length && r > CONFIG.wwrEdges[i] + 1e-9) i++;
    return CONFIG.wwrColors[i];
  }
  const wwrStep = (r) => { let i = 0; while (i < CONFIG.wwrEdges.length && r > CONFIG.wwrEdges[i] + 1e-9) i++; return i; };

  function build(D, state, disp, mats) {
    const v = state.view;
    const diagram = v.style === 'diagram';
    const draft = disp.quality === 'draft';
    const model = [];
    const col = (hex) => new THREE.Color(hex);
    const white = cssModel();
    const wallBase = diagram ? col('#ffffff') : white;
    const opaque = new Buf(), glass = new Buf(), mull = new Buf();
    const T = CONFIG.wallThickness, LIFT = CONFIG.glassLift;
    const wallColorOf = (face) => {
      const mat = bandMaterial(state, face);
      if (diagram) {
        if (v.colorBy === 'wwr') return col(wwrColor((D.groupInfo[face.groupId] || {}).wwr || 0));
        return col(CONFIG.systemColors[(face.rule && face.rule.system) || 'punched'] || '#999999');
      }
      return mat && CONFIG.materialColors[mat] ? col(CONFIG.materialColors[mat]) : wallBase.clone();
    };

    for (const face of D.faces) {
      let el;
      try { el = ElevMod.faceElements(state, face); } catch (e) { console.error(e); continue; }
      const own = face.groupId, L = face.length, h = face.ftf;
      const wall = wallColorOf(face);
      opaque.box(face, 0, L, 0, h, -T, 0, wall, own);
      const solidColor = diagram ? wall.clone().multiplyScalar(0.82) : wall.clone().lerp(col('#c9ccd0'), 0.3);
      for (const p of face.panels || []) {
        if (p.kind === 'solid') opaque.box(face, p.u0, p.u1, 0, h, 0, 0.12, solidColor, own);
      }
      for (const s of el.spandrel) opaque.box(face, s.u0, s.u1, s.v0, s.v1, 0, 0.12, solidColor, own);
      const inset = state.balconies.on && state.balconies.type === 'inset';
      for (const g of el.glass) {
        const isDoor = g.kind === 'door';
        const lift = isDoor && inset ? 0.3 : LIFT;
        glass.box(face, g.u0, g.u1, g.v0, g.v1, isDoor && inset ? 0.12 : 0, lift, col(diagram ? CONFIG.glassColorDiagram : isDoor ? CONFIG.doorColor : CONFIG.glassColor), own);
      }
      for (const b of el.balconies) {
        if (b.type === 'inset') {
          opaque.box(face, b.u0, b.u1, b.v0, b.v1, 0, 0.12, col(CONFIG.recessColor), own);
        } else {
          opaque.box(face, b.u0, b.u1, b.v0, b.v1, 0, b.depth, diagram ? wall.clone().multiplyScalar(0.9) : col('#dcdfe2'), own);
          glass.box(face, b.u0, b.u1, 0, 3.5, b.depth - 0.12, b.depth, col(diagram ? '#ffffff' : CONFIG.glassColor), own);
        }
      }
      for (const s of el.shades) opaque.box(face, s.u0, s.u1, s.v0, s.v1, 0, s.depth, diagram ? col('#8a93a0') : col('#c9ced4'), own);
      if (!draft) {
        for (const f of el.fins) opaque.box(face, f.u - f.width / 2, f.u + f.width / 2, 0, h, 0, f.depth, diagram ? col('#8a93a0') : col('#c9ced4'), own);
        if (v.mullions) {
          const mW = Math.max(0.12, num(face.rule && face.rule.mullionW, 0.2)), mD = Math.max(0.2, num(face.rule && face.rule.mullionD, 0.4));
          const mc = col(diagram ? '#5a6470' : CONFIG.mullionColor);
          for (const m of el.mullions) mull.box(face, m.u - mW / 2, m.u + mW / 2, m.v0, m.v1, 0, mD, mc, own);
          if ((face.rule && face.rule.system) === 'punched') {
            for (const g of el.glass) if (g.kind !== 'door') {
              for (const u of [g.u0, g.u1]) mull.box(face, u - mW / 2, u + mW / 2, g.v0, g.v1, 0, mD, mc, own);
            }
          }
        }
      }
    }

    const flat = (key) => mats.mesh(key);
    const om = opaque.mesh(flat('opaque'), { cast: true });
    const gm = glass.mesh(flat('glass'), { order: 3 });
    const mm = mull.mesh(flat('mullion'), { cast: false, order: 2 });
    for (const x of [om, gm, mm]) if (x) model.push(x);

    // roof cap of every level: closes the top of the massing (the wall boxes are thin)
    const caps = [];
    for (const lv of D.levels) {
      try { caps.push(extrude(lv.plates, lv.z + lv.ftf - 0.4, 0.4)); } catch (e) { /* skip a bad level */ }
    }
    if (caps.length) {
      const merged = caps.length === 1 ? caps[0] : BufferGeometryUtils.mergeGeometries(caps, false);
      if (caps.length > 1) caps.forEach((g) => g.dispose());
      if (merged) {
        const mesh = new THREE.Mesh(merged, mats.mesh('mass'));
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.model = true; mesh.userData.cap = true;
        model.push(mesh);
      }
    }
    return { model, overlay: buildOverlay(D, state, mats) };
  }

  /** Street faces: an orange dashed line along the ground edge, offset a foot outward, plus a flat label (plan view and Diagram). */
  function buildOverlay(D, state, mats) {
    const out = [];
    const low = D.levels.length ? D.levels[0] : null;
    if (!low) return out;
    const ids = new Set(D.street || []);
    const pos = [];
    for (const g of D.groups) {
      if (!ids.has(g.id)) continue;
      const nx = g.normal ? g.normal[0] : 0, ny = g.normal ? g.normal[1] : 0;
      const a = [g.a[0] + nx * 1.5, g.a[1] + ny * 1.5], b = [g.b[0] + nx * 1.5, g.b[1] + ny * 1.5];
      pos.push(...W3(a[0], a[1], low.z + 0.3), ...W3(b[0], b[1], low.z + 0.3));
      const t = Overlays.label('STREET', (a[0] + b[0]) / 2 + nx * 4, (a[1] + b[1]) / 2 + ny * 4, low.z + 0.5, { height: 3.2, color: '#9a4f0a' });
      t.userData.plan = true;
      out.push(t);
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const ls = new THREE.LineSegments(geo, mats.line('street'));
      ls.frustumCulled = false; ls.renderOrder = 5;
      out.push(ls);
    }
    return out;
  }

  return { build, extrude, wwrColor, wwrStep, bandMaterial };
})();
