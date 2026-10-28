/* ==========================================================================
   PARKING: facade screening (app/tools/parking/screen.js)

   A screen is a vertical band drawn along every OUTER ring edge of a deck level, from the top of that level's slab
   up to the underside of the next slab. The top level (open roof) is never screened.

   Three types:
     'open'  no screen; the deck keeps its barrier only.
     'solid' an opaque panel.
     'mesh'  a perforated metal panel, openness 0 to 50 percent (0 = no holes, 50 = half open).
   Openness is stored for the later open parking garage calculation (screenOpenness).

   Geometry is authored in the deck LOCAL plan frame (feet) and mapped to Three world axes with planToWorld, exactly
   like deck3d.js. The caller places the group with ctx.frame.placeGroup.

   Level heights follow deck3d.js: `z` is the floor surface (top of that level's slab); the slab is `slab` ft thick
   and hangs BELOW z. So a screen runs from z up to (next z - slab), which is the clear height of the level.
   ========================================================================== */
import * as THREE from 'three';
import { planToWorld } from '../../core/frame.js';

export const SCREEN_TYPES = [
  { value: 'open', label: 'Open' },
  { value: 'solid', label: 'Solid' },
  { value: 'mesh', label: 'Mesh' },
];

export const MAX_OPENNESS = 50;
const SLAB = 0.8;            // default slab thickness, ft (deck3d CONFIG.slabThickness)
const INSET = 0.1;           // panel sits this far outside the slab edge so it does not z-fight, ft
/** Visual hole pitch, ft. Real perforated metal has a pitch of a few inches; at 100 to 500 ft that is below a pixel and
    would shimmer, so the pattern is drawn at a visual pitch of 2 ft. It reads as a texture, never as single holes. */
const PITCH = 2;
const TILE = 64;             // texture tile size, px (one tile = one pitch)
const SS = 4;                // supersampling per axis when drawing a hole

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/* ---------- state ---------- */
export function defaultScreen() { return { type: 'open', openness: 30 }; }

/** A valid screen object: type in the list, openness an integer 0..50. */
export function normScreen(s) {
  const o = s && typeof s === 'object' ? s : {};
  const type = SCREEN_TYPES.some((t) => t.value === o.type) ? o.type : 'open';
  const raw = fin(o.openness) ? o.openness : 30;
  return { type, openness: Math.min(MAX_OPENNESS, Math.max(0, Math.round(raw))) };
}

/* ---------- which levels, which rings ---------- */
/**
 * The screened bands: every level except the top one. -> [{ z, y0, y1, h, rings: [outer ring, …] }]
 * y0 = z (top of the slab), y1 = next z - slab, h = y1 - y0 (the clear height). The next level is the next higher z;
 * when there is none the top level is skipped (open roof).
 */
function bands(levels, slab) {
  const ls = (Array.isArray(levels) ? levels : []).filter((l) => l && fin(l.z)).slice().sort((a, b) => a.z - b.z);
  const out = [];
  for (let i = 0; i + 1 < ls.length; i++) {
    const l = ls[i];
    const next = ls[i + 1].z;
    let h = next - slab - l.z;
    if (!(h > 0.05) && fin(l.ftf)) h = l.ftf - slab;
    if (!(h > 0.05)) continue;
    const rings = [];
    for (const poly of l.plate || []) {
      const r = poly && poly.outer;
      if (Array.isArray(r) && r.length >= 3) rings.push(r);
    }
    out.push({ z: l.z, y0: l.z, y1: l.z + h, h, rings });
  }
  return out;
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};
const ringLen = (r) => {
  let L = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; L += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  return L;
};
/** The ring without repeated closing/duplicate points; null when fewer than 3 distinct points remain. */
function cleanRing(r) {
  const out = [];
  for (const p of r) {
    if (!p || !fin(p[0]) || !fin(p[1])) continue;
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out.length >= 3 ? out : null;
}
/** The ring moved outward by d with mitered corners (no gaps at corners). Counter-clockwise result is not forced. */
function offsetOut(r, d) {
  const ccw = ringArea(r) > 0;
  const n = r.length;
  const nrm = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return ccw ? [dy / L, -dx / L] : [-dy / L, dx / L];
  };
  return r.map((p, i) => {
    const n0 = nrm(r[(i + n - 1) % n], p), n1 = nrm(p, r[(i + 1) % n]);
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    if (k < 0.15) return [p[0] + n1[0] * d, p[1] + n1[1] * d];          // a spike: do not shoot the corner away
    return [p[0] + (n0[0] + n1[0]) * d / k, p[1] + (n0[1] + n1[1]) * d / k];
  });
}

/* ---------- wall and open area (pure) ---------- */
/**
 * -> { wallArea, openArea, percent, perLevel: [{ z, wallArea, openArea }] } in sf.
 * wall area = outer perimeter x clear height for every screened level (the same levels as buildScreens).
 * open fraction: open 1, mesh openness / 100, solid 0.
 */
export function screenOpenness(levels, screen, opts = {}) {
  const sc = normScreen(screen);
  const slab = fin(opts.slab) ? opts.slab : SLAB;
  const f = sc.type === 'open' ? 1 : sc.type === 'mesh' ? sc.openness / 100 : 0;
  const perLevel = [];
  let wall = 0, open = 0;
  for (const b of bands(levels, slab)) {
    let per = 0;
    for (const r of b.rings) per += ringLen(r);
    const w = per * b.h;
    perLevel.push({ z: b.z, wallArea: w, openArea: w * f });
    wall += w; open += w * f;
  }
  return { wallArea: wall, openArea: open, percent: wall > 0 ? (open / wall) * 100 : 0, perLevel };
}

/* ---------- perforation texture ---------- */
const METAL = 236, HOLE = 70;     // grey levels of the metal and of a hole (a dark look into the deck)

/**
 * One tile of a regular round-hole pattern (one hole centered in a PITCH x PITCH cell).
 * The hole area fraction equals openness / 100: pi r^2 = f pitch^2, r = pitch sqrt(f / pi). At 50 percent r is 0.40 pitch,
 * so the holes never touch. Edges are anti-aliased by supersampling.
 * -> { data: Uint8Array RGBA, size, fraction (exact coverage), metal, hole }
 */
export function perforationData(openness, size = TILE) {
  const f = Math.min(MAX_OPENNESS, Math.max(0, fin(openness) ? openness : 0)) / 100;
  const r = Math.sqrt(f / Math.PI);                      // in pitch units
  const data = new Uint8Array(size * size * 4);
  let cov = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size - 0.5, v = (y + (sy + 0.5) / SS) / size - 0.5;
          if (u * u + v * v <= r * r) hit++;
        }
      }
      const c = hit / (SS * SS);
      cov += c;
      const g = Math.round(METAL + (HOLE - METAL) * c);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
    }
  }
  return { data, size, fraction: cov / (size * size), metal: METAL, hole: HOLE };
}

const texCache = new Map();
/** A shared, cached, mip-mapped repeating texture for an openness value (null when there is no DOM-free texture support). */
function perforationTexture(openness) {
  const key = Math.round(openness);
  if (texCache.has(key)) return texCache.get(key);
  let tex = null;
  try {
    const p = perforationData(key);
    tex = new THREE.DataTexture(p.data, p.size, p.size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;      // mip-mapped: far away the holes average out, no shimmer
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(1 / PITCH, 1 / PITCH);                // UVs are in feet, one tile covers PITCH feet
    tex.needsUpdate = true;
  } catch (e) { tex = null; }
  texCache.set(key, tex);
  return tex;
}

/** The opacity of a mesh screen: 1 at 0 percent, falling 1.2 per unit of openness fraction, never below 0.35. */
export function meshOpacity(openness) {
  const o = Math.min(MAX_OPENNESS, Math.max(0, fin(openness) ? openness : 0));
  return Math.min(1, Math.max(0.35, 1 - (o / 100) * 1.2));
}

/* ---------- materials ---------- */
function tokenColor(opts, name, fb) {
  try {
    if (typeof opts.css === 'function') {
      const c = opts.css(name, fb);
      if (c && c.isColor) return c.clone();
    }
  } catch (e) { /* use the fallback */ }
  return new THREE.Color(fb);
}
/** A mid-dark neutral that reads on the dark theme: scene-model mixed toward scene-context. */
function baseColor(opts) {
  return tokenColor(opts, '--scene-model', '#efefec').lerp(tokenColor(opts, '--scene-context', '#6f7882'), 0.85);
}

function solidMaterial(opts) {
  return new THREE.MeshStandardMaterial({
    color: baseColor(opts), roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
}
function meshMaterial(opts, openness) {
  const tex = perforationTexture(openness);
  const m = new THREE.MeshStandardMaterial({
    color: baseColor(opts).lerp(new THREE.Color('#ffffff'), 0.18),     // a little lighter than solid: reads as metal
    roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide,
    transparent: true, opacity: meshOpacity(openness), depthWrite: false,
  });
  if (tex && openness > 0) m.map = tex;
  return m;
}

/* ---------- geometry ---------- */
/**
 * levels: [{ z, ftf?, plate: MultiPoly [{ outer, holes }] }] in the deck local plan frame (feet).
 * screen: { type, openness }. opts: { slab = 0.8, css(name, fallback) -> THREE.Color }.
 * -> THREE.Group with one merged mesh, or null (open, no screened level, or no edges).
 */
export function buildScreens(levels, screen, opts = {}) {
  const sc = normScreen(screen);
  if (sc.type === 'open') return null;
  const slab = fin(opts.slab) ? opts.slab : SLAB;
  const pos = [], nor = [], uv = [];
  let quads = 0;

  for (const b of bands(levels, slab)) {
    for (const raw of b.rings) {
      const clean = cleanRing(raw);
      if (!clean) continue;
      const ccw = ringArea(clean) > 0;
      const ring = offsetOut(clean, INSET);
      const n = ring.length;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const a = ring[i], c = ring[(i + 1) % n];
        const ex = c[0] - a[0], ey = c[1] - a[1], len = Math.hypot(ex, ey);
        if (len < 1e-6) continue;
        const nx = ccw ? ey / len : -ey / len, ny = ccw ? -ex / len : ex / len;     // outward, in plan
        const nw = [nx, 0, -ny];                                                    // outward, in world
        const A0 = planToWorld(a[0], a[1], b.y0), B0 = planToWorld(c[0], c[1], b.y0);
        const B1 = planToWorld(c[0], c[1], b.y1), A1 = planToWorld(a[0], a[1], b.y1);
        const uA = u, uB = u + len, v1 = b.h;
        /* the triangles wind counter-clockwise seen from outside */
        const cr = [
          (B0[1] - A0[1]) * (B1[2] - A0[2]) - (B0[2] - A0[2]) * (B1[1] - A0[1]),
          (B0[2] - A0[2]) * (B1[0] - A0[0]) - (B0[0] - A0[0]) * (B1[2] - A0[2]),
          (B0[0] - A0[0]) * (B1[1] - A0[1]) - (B0[1] - A0[1]) * (B1[0] - A0[0]),
        ];
        const flip = cr[0] * nw[0] + cr[1] * nw[1] + cr[2] * nw[2] < 0;
        const P = [[A0, uA, 0], [B0, uB, 0], [B1, uB, v1], [A1, uA, v1]];
        const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
        for (const k of order) {
          pos.push(P[k][0][0], P[k][0][1], P[k][0][2]);
          nor.push(nw[0], nw[1], nw[2]);
          uv.push(P[k][1], P[k][2]);
        }
        u = uB; quads++;
      }
    }
  }
  if (!quads) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = sc.type === 'solid' ? solidMaterial(opts) : meshMaterial(opts, sc.openness);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `parking-screen-${sc.type}`;
  mesh.castShadow = sc.type === 'solid';
  mesh.receiveShadow = true;
  mesh.renderOrder = sc.type === 'mesh' ? 2 : 0;
  mesh.userData.screen = true;
  mesh.userData.occludes = false;
  mesh.userData.quads = quads;
  const group = new THREE.Group();
  group.name = 'parking-screens';
  group.userData.screen = true;
  group.userData.occludes = false;
  group.add(mesh);
  /* the perforation textures are shared and cached, so only the geometry and the material are freed */
  group.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return group;
}

/* ---------- panel UI ---------- */
/**
 * The Screen section: Open / Solid / Mesh, and (Mesh only) an Openness slider.
 * bind: { type: {get,set,commit}, openness: {get,set,commit} }. -> HTMLElement.
 */
export function screenSection(Controls, bind) {
  const wrap = document.createElement('div');
  wrap.className = 'screen-section';
  const type = Controls.segmented({ label: 'Screen', bind: bind.type, options: SCREEN_TYPES });
  const openness = Controls.when(() => bind.type.get() === 'mesh', [
    Controls.slider({
      label: 'Openness', bind: bind.openness, min: 0, max: MAX_OPENNESS, step: 1, hardMin: 0, hardMax: MAX_OPENNESS,
      integer: true, format: (v) => `${Math.round(v)}% open`, parse: (t) => parseFloat(String(t).replace(/[^0-9.\-]/g, '')),
    }),
  ]);
  wrap.append(type.el, openness.el,
    Controls.help('Openness is the open area of the screen. Later it feeds the open parking garage check.'));
  return wrap;
}
