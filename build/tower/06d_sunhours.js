/* ==========================================================================
   SUN-HOURS LAYER  (docs/tower-project-sun-plan.md sections 4.1 and 6.2)
   `SunLayer` draws the sun-hours heat map: one ground quad at z = 0.05 ft with a canvas texture (one pixel per
   grid node, nearest filter, 75 percent opacity) and the legend. Hidden in Diagram style and in AI-ready images
   (Render hides the whole sun group there; the Diagram check is here).
   The result comes from SunUI (08d_sun.js) through setResult. The grid is in the project frame (frame "project",
   drawn through the current placement) or in the tower local frame (frame "local").
   ========================================================================== */
const SunLayer = (() => {
  // Hours of sun -> color (plan section 6.2): 0-2, 2-4, 4-6, 6-8, 8 and more.
  const RAMP = [
    { max: 2, color: '#2c3e73', label: '0 to 2 h' },
    { max: 4, color: '#4f7fd1', label: '2 to 4 h' },
    { max: 6, color: '#58a65c', label: '4 to 6 h' },
    { max: 8, color: '#e3c34a', label: '6 to 8 h' },
    { max: Infinity, color: '#e0762f', label: '8 h and more' },
  ];
  const OPACITY = 0.75;
  const ELEV = 0.05;           // ft above the ground slab

  let res = null;              // { id, key, frame, spacing, nx, ny, x0, y0, date, step, hours, dayLength, ... }
  let stale = false;
  let counter = 0;
  let suppressed = false;      // the shadow study sheet hides the heat map while it captures
  let keyFn = null;            // (state, d) -> string: what the result depends on (set by SunUI)
  let onChange = null;         // called when the stale flag changes
  let cur = null;              // { tex, mat, mesh } of the layer as drawn
  let shown = false;
  let legendEl = null, legendKey = '';

  const rampIndex = (v) => { for (let i = 0; i < RAMP.length; i++) if (v < RAMP[i].max) return i; return RAMP.length - 1; };
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

  function placementOf(state) {
    const p = state && state.placement;
    return p && typeof p === 'object' && isFinite(p.x) && isFinite(p.y) ? { x: p.x, y: p.y, rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : null;
  }

  /** The grid corners (cells extend half a spacing around each node) in the tower local frame: SW, SE, NE, NW. */
  function cornersLocal(r, pl) {
    const s = r.spacing, h = s / 2;
    const xa = r.x0 - h, xb = r.x0 + (r.nx - 1) * s + h, ya = r.y0 - h, yb = r.y0 + (r.ny - 1) * s + h;
    const ring = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]];
    if (r.frame !== 'project' || !pl) return ring;
    try { return ProjectMod.transformRing(pl, ring, 'toLocal'); } catch (e) { return ring; }
  }

  function buildMesh(r, pl) {
    const canvas = document.createElement('canvas');
    canvas.width = r.nx; canvas.height = r.ny;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(r.nx, r.ny);
    const rgb = RAMP.map((x) => hex(x.color));
    for (let j = 0; j < r.ny; j++) {
      const row = (r.ny - 1 - j) * r.nx;             // canvas row 0 is the top; node row 0 is the south edge
      for (let i = 0; i < r.nx; i++) {
        const c = rgb[rampIndex(r.hours[j * r.nx + i])];
        const o = 4 * (row + i);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: OPACITY, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const c = cornersLocal(r, pl);
    const pos = new Float32Array(12);
    c.forEach((q, k) => { const w = planToWorld(q[0], q[1], ELEV); pos[3 * k] = w[0]; pos[3 * k + 1] = w[1]; pos[3 * k + 2] = w[2]; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.userData.sunHours = true;
    cur = { tex, mat, mesh, w: r.nx, h: r.ny };
    return mesh;
  }

  function disposeCur() {
    if (!cur) return;
    if (cur.tex) cur.tex.dispose();
    if (cur.mat) cur.mat.dispose();
    cur = null;
  }

  function ensureLegend() {
    if (legendEl) return legendEl;
    const host = document.getElementById('viewport');
    if (!host) return null;
    legendEl = h('div', { class: 'legend', id: 'sunLegend', hidden: true, role: 'group', 'aria-label': 'Hours of sun legend' });
    host.append(legendEl);
    return legendEl;
  }
  const monthDay = (md) => {
    const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(String(md || ''));
    if (!m) return '';
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[1] - 1]} ${+m[2]}`;
  };
  function paintLegend(visible) {
    const box = ensureLegend();
    if (!box) return;
    box.hidden = !visible;
    if (!visible) return;
    const key = JSON.stringify([res && res.id, stale]);
    if (key === legendKey) return;
    legendKey = key;
    box.textContent = '';
    box.append(h('div', { class: 'label' }, `Hours of sun${res ? ` · ${monthDay(res.date)}` : ''}`));
    for (const x of RAMP) box.append(h('div', { class: 'lg-row' }, h('span', { class: 'sw', style: `background:${x.color}` }), h('span', null, x.label)));
    if (res) box.append(h('div', { class: 'lg-row', style: 'color:var(--ink-3);font-size:11px' }, `Day length ${(res.dayLength || 0).toFixed(1)} h`));
    if (stale) box.append(h('div', { class: 'lg-row', 'data-sun': 'legend-stale', style: 'color:var(--warn);font-weight:600' }, 'Out of date'));
  }

  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key }; state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, materialFor, lineMaterial }.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) {
    let changed = false;
    if (res && keyFn) {
      const next = keyFn(state, d) !== res.key;
      if (next !== stale) { stale = next; if (onChange) { try { onChange(); } catch (e) { console.error(e); } } }
    }
    const sun = state.sun;
    const wanted = !!(sun && sun.hours && sun.hours.on) && !!res;
    const diagram = state.view && state.view.style === 'diagram';
    const show = wanted && !diagram && !suppressed;
    const pl = res && res.frame === 'project' ? placementOf(state) : null;
    const key = res ? `${res.id}|${pl ? `${pl.x},${pl.y},${pl.rotation}` : ''}` : 'none';
    if (layer.key !== key) {
      disposeCur();
      changed = kit.syncLayer(layer, key, () => (res ? [buildMesh(res, pl)] : [])) || changed;
    }
    if (cur && cur.mesh.visible !== show) { cur.mesh.visible = show; changed = true; }
    if (show !== shown) { shown = show; changed = true; }
    paintLegend(wanted && !diagram && !suppressed);
    return changed;
  }

  /** A finished sunHours result (plan section 3.6 "Output"), or null to clear it.
   *  r: { spacing, nx, ny, x0, y0, frame, date, step, hours (Float32Array), dayLength, key? } */
  function setResult(r) {
    if (!r) { clear(); return; }
    res = { ...r, id: ++counter, key: r.key || '' };
    stale = false; legendKey = '';
    if (onChange) { try { onChange(); } catch (e) { console.error(e); } }
    if (typeof Render !== 'undefined' && Render.requestRender) Render.requestRender();
  }
  function clear() {
    res = null; stale = false; legendKey = '';
    if (onChange) { try { onChange(); } catch (e) { console.error(e); } }
    if (typeof Render !== 'undefined' && Render.requestRender) Render.requestRender();
  }
  /** The form changed after a compute: show "Out of date" and keep the old colors. */
  function markStale(v = true) {
    if (!res || stale === !!v) return;
    stale = !!v; legendKey = '';
    if (onChange) { try { onChange(); } catch (e) { console.error(e); } }
  }
  function summary() {
    if (!res) return null;
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (let i = 0; i < res.hours.length; i++) { const v = res.hours[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    const n = res.hours.length || 1;
    return {
      id: res.id, frame: res.frame, spacing: res.spacing, nx: res.nx, ny: res.ny, x0: res.x0, y0: res.y0, date: res.date, step: res.step,
      dayLength: res.dayLength, samples: res.samples, ms: res.ms, nodes: res.hours.length, min: mn, max: mx, mean: sum / n,
    };
  }
  function info() {
    return {
      shown, stale, result: summary(), legend: !!(legendEl && !legendEl.hidden), suppressed,
      texture: cur ? { w: cur.w, h: cur.h, filter: cur.tex.magFilter === THREE.NearestFilter ? 'nearest' : 'other', opacity: cur.mat.opacity } : null,
    };
  }
  /** The full result (with the hours array), for the project file and the tests. */
  const result = () => res;
  /** Hours at the node nearest to a point in the result's own frame. */
  function hoursAt(x, y) {
    if (!res) return null;
    const i = Math.round((x - res.x0) / res.spacing), j = Math.round((y - res.y0) / res.spacing);
    if (i < 0 || j < 0 || i >= res.nx || j >= res.ny) return null;
    return res.hours[j * res.nx + i];
  }
  return {
    update, setResult, clear, markStale, info, result, hoursAt, ramp: RAMP,
    setKeyFn: (fn) => { keyFn = fn; },
    onChange: (fn) => { onChange = fn; },
    suppress: (v) => { suppressed = !!v; if (typeof Render !== 'undefined' && Render.requestRender) Render.requestRender(); },
  };
})();
