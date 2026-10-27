/* ==========================================================================
   PARKING: selection handles
   Port of build/parking/06b_select.js (handles, snapping, the drag label). A tap on the footprint, a core, an entry or the
   speed ramp selects it (the shell card shows it and tool.card adds buttons). The selected item gets grips in #handles:
     footprint (standalone rectangle): move, width, depth, rotate      core: move      entry: slide      speed ramp: move, length
   A grip starts a gesture through ctx.input.start. Every move writes the store live; the release commits one undo step.
   Snapping (src/tower/snap.js): layout lines (deck edges, rows, aisles, column lines, strip, other cores) for cores, entries and
   the speed ramp; the plates of the massing for the footprint; a 1 ft or 5 ft grid. Alt turns snapping off.
   The placement gizmo (app/core/placement.js) moves and turns the whole standalone deck on the site; it is off while a grip shows.
   ========================================================================== */
import * as THREE from 'three';
import * as SnapMod from '../../../src/tower/snap.js';
import { toProject } from '../../../src/shared/project.js';
import { Units } from '../../core/ui-kit.js';
import { CONFIG, num, clamp, rnd, boxOfRings, boxOfPolys, RampsMod } from './state.js';

const KINDS = ['footprint', 'core', 'entry', 'speed'];
const TOL_PX = 12, TOL_PX_TOUCH = 16;
const GUIDE_COLOR = '#f28a1a';
const MAXD = CONFIG.limits.maxDim;
const fmt = (v) => Units.formatFeetInches(v);
const r4 = (v) => rnd(v, 10000);
const clone = (o) => JSON.parse(JSON.stringify(o));
const box4 = (b) => ({ minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] });

const HANDLE_TEXT = {
  move: 'Move', slide: 'Slide along the side', rotate: 'Rotate the footprint', width: 'Change the width', depth: 'Change the depth', length: 'Change the ramp length',
};

export function createHandles(T) {
  const C = T.ctx;
  const { h } = C.ui;
  const host = () => document.getElementById('handles');
  let on = false;
  let sel = null;                 // { kind, id }
  let drag = null;
  let last = null;                // label and guides of the last drag step (tests)
  const els = {};                 // handle id -> element
  let labelEl = null;
  const guideGroup = new THREE.Group();
  guideGroup.name = 'parking-guides';
  C.scene.overlayRoot.add(guideGroup);
  const guideMat = new THREE.LineBasicMaterial({ color: GUIDE_COLOR, depthTest: false, transparent: true, opacity: 0.95 });

  /* ---- the selected item ---- */
  const S = () => T.store.raw();
  const D = () => T.derived.get();
  const same = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;

  function valid(it) {
    if (!it || !KINDS.includes(it.kind)) return false;
    const s = S();
    switch (it.kind) {
      case 'footprint': return s.source === 'standalone' && s.footprint.shape !== 'polygon';
      case 'core': { const c = T.coreOf(it.id); return !!c && !c.fromProject && T.coreIndex(it.id) >= 0; }
      case 'entry': return T.entryIndex(it.id) >= 0;
      case 'speed': return s.ramp.type === 'speed' && !!RampsMod.speedRampFootprint(s);
      default: return false;
    }
  }
  const basePath = (it) => {
    switch (it.kind) {
      case 'footprint': return 'footprint';
      case 'core': { const i = T.coreIndex(it.id); return i < 0 ? null : `cores.${i}`; }
      case 'entry': { const i = T.entryIndex(it.id); return i < 0 ? null : `entries.${i}`; }
      default: return 'ramp.speed';
    }
  };

  /** The rectangle footprint as ring corners in the local (massing) frame. */
  function footprintRing(f) {
    const w = num(f.width, 0), dd = num(f.depth, 0), a = (num(f.angle, 0) * Math.PI) / 180;
    const u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)], c = [num(f.x, 0), num(f.y, 0)];
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + u[0] * w / 2 * i + v[0] * dd / 2 * j, c[1] + u[1] * w / 2 * i + v[1] * dd / 2 * j]);
  }
  /** Plan box of the item and the frame it lives in. */
  function boxOf(it) {
    const s = S(), d = D();
    if (it.kind === 'footprint') return { box: boxOfRings([footprintRing(s.footprint)]), frame: 'local' };
    if (it.kind === 'core') { const c = T.coreOf(it.id); return c ? { box: c.box, frame: 'layout' } : null; }
    if (it.kind === 'entry') {
      const en = s.entries[T.entryIndex(it.id)];
      const ring = en && d.frame && d.frame.W ? T.entryLaneRing(en) : null;
      return ring ? { box: boxOfRings([ring]), frame: 'layout' } : null;
    }
    const fp = RampsMod.speedRampFootprint(s);
    return fp ? { box: box4(fp.box), frame: 'layout' } : null;
  }

  /** The grips of the item: { id, kind, at: [x, y] in its frame, z (deck elevation), frame }. */
  function gripsOf(it) {
    const s = S();
    const fp = boxOf(it);
    if (!fp) return [];
    const b = fp.box, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const r = T.zRange(it.kind);
    const out = [];
    if (it.kind === 'footprint') {
      const f = s.footprint;
      const a = (num(f.angle, 0) * Math.PI) / 180, w = num(f.width, 0), dd = num(f.depth, 0);
      const u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)], c = [num(f.x, 0), num(f.y, 0)];
      out.push({ id: 'move', kind: 'move', at: c, z: r.z1, frame: 'local' });
      out.push({ id: 'width', kind: 'resize', at: [c[0] + u[0] * w / 2, c[1] + u[1] * w / 2], z: r.z1, frame: 'local' });
      out.push({ id: 'depth', kind: 'resize', at: [c[0] + v[0] * dd / 2, c[1] + v[1] * dd / 2], z: r.z1, frame: 'local' });
      out.push({ id: 'rotate', kind: 'rotate', at: [c[0] + u[0] * (w / 2 + 22) + v[0] * (dd / 2 + 22), c[1] + u[1] * (w / 2 + 22) + v[1] * (dd / 2 + 22)], z: r.z0, frame: 'local' });
    } else if (it.kind === 'core') {
      out.push({ id: 'move', kind: 'move', at: [cx, cy], z: r.z1, frame: 'layout' });
    } else if (it.kind === 'entry') {
      out.push({ id: 'slide', kind: 'move', at: [cx, cy], z: r.z1, frame: 'layout' });
    } else {
      out.push({ id: 'move', kind: 'move', at: [cx, cy], z: r.z1, frame: 'layout' });
      out.push({ id: 'length', kind: 'resize', at: [b.maxX, cy], z: r.z1, frame: 'layout' });
    }
    return out;
  }

  /* ---- frames and the pointer ---- */
  function projectOf(at, frame) {
    const local = frame === 'layout' ? T.layoutToLocal(at) : at;
    return T.localToProject(local);
  }
  function worldOf(at, z, frame) {
    const p = projectOf(at, frame);
    const q = C.frame.toScene([p[0], p[1], num(T.placementOf().baseZ, 0) + z]);
    return C.frame.worldVec(q[0], q[1], q[2]);
  }
  /** The plan point under the pointer on the horizontal plane at deck elevation z, in the item's frame, or null. */
  function pointerPoint(cx, cy, z, frame) {
    const sh = C.frame.getShift();
    const sp = C.scene.groundPoint(cx, cy, num(T.placementOf().baseZ, 0) + z - sh.z);
    if (!sp) return null;
    const pr = C.frame.fromScene([sp[0], sp[1], 0]);
    const local = T.projectToLocal([pr[0], pr[1]]);
    return frame === 'layout' ? T.localToLayout(local) : local;
  }
  const toRect = (c) => { const r = host().getBoundingClientRect(); return { x: c.x - r.left, y: c.y - r.top }; };
  function pxPerFt(it, g) {
    const a = C.scene.toScreen(worldOf(g.at, g.z, g.frame));
    const b = C.scene.toScreen(worldOf([g.at[0] + 10, g.at[1]], g.z, g.frame));
    const d = Math.hypot(b.x - a.x, b.y - a.y) / 10;
    return d > 1e-6 ? d : 1;
  }

  /* ---- snapping targets ---- */
  function boxLinesOf(out, b, kind, label) {
    out.push({ axis: 'x', value: b.minX, kind, label: `${label} west edge`, from: b.minY, to: b.maxY });
    out.push({ axis: 'x', value: b.maxX, kind, label: `${label} east edge`, from: b.minY, to: b.maxY });
    out.push({ axis: 'y', value: b.minY, kind, label: `${label} south edge`, from: b.minX, to: b.maxX });
    out.push({ axis: 'y', value: b.maxY, kind, label: `${label} north edge`, from: b.minX, to: b.maxX });
  }
  function layoutTargets(exclude) {
    const d = D(), raw = d.raw, out = [];
    const W = raw.frame.W, Dp = raw.frame.D;
    boxLinesOf(out, { minX: 0, maxX: W, minY: 0, maxY: Dp }, 'site', 'Deck');
    if (raw.run) {
      out.push({ axis: 'x', value: raw.run.xs, kind: 'setback', label: 'Start of the stall run', from: 0, to: Dp });
      out.push({ axis: 'x', value: raw.run.xe, kind: 'setback', label: 'End of the stall run', from: 0, to: Dp });
    }
    for (const bay of raw.bays) {
      const xs = raw.run ? raw.run.xs : 0, xe = raw.run ? raw.run.xe : W;
      for (const row of bay.rows) {
        out.push({ axis: 'y', value: row.y0, kind: 'podium', label: `Row ${row.id} south edge`, from: xs, to: xe });
        out.push({ axis: 'y', value: row.y1, kind: 'podium', label: `Row ${row.id} north edge`, from: xs, to: xe });
      }
      if (bay.aisle) {
        out.push({ axis: 'y', value: bay.aisle.y0, kind: 'podium', label: 'Aisle south edge', from: xs, to: xe });
        out.push({ axis: 'y', value: bay.aisle.y1, kind: 'podium', label: 'Aisle north edge', from: xs, to: xe });
      }
    }
    if (raw.strip) {
      out.push({ axis: 'y', value: raw.strip.y0, kind: 'context', label: 'Strip south edge', from: 0, to: W });
      out.push({ axis: 'y', value: raw.strip.y1, kind: 'context', label: 'Strip north edge', from: 0, to: W });
    }
    const cols = d.columns && d.columns.lines;
    if (Array.isArray(cols) && cols.length) {
      const xs = new Set();
      for (const l of cols) for (const x of l.xs || []) xs.add(Math.round(x * 100) / 100);
      const ys = cols.map((l) => l.y), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const x of xs) out.push({ axis: 'x', value: x, kind: 'setback', label: 'Column line', from: y0, to: y1 });
    }
    for (const c of d.cores) if (!(exclude && exclude.kind === 'core' && exclude.id === c.id)) boxLinesOf(out, c.box, 'segment', `Core ${c.id}`);
    return out;
  }
  /** The plates of the massing as lines in the deck's local frame. */
  function localTargets() {
    const out = [];
    try {
      const mp = T.readers.massingPlacement();
      for (const g of T.readers.ghostLevels(S())) {
        let polys = g.polys;
        if (mp) {
          polys = polys.map((p) => ({ outer: p.outer.map((q) => { const pr = toProject(mp, [q[0], q[1]]); return T.projectToLocal([pr[0], pr[1]]); }) }));
        }
        const b = boxOfPolys(polys);
        if (b) boxLinesOf(out, b, 'context', 'Massing');
      }
    } catch (e) { /* no project */ }
    return out;
  }

  /* ---- guides ---- */
  function clearGuides() {
    guideGroup.children.slice().forEach((c) => { guideGroup.remove(c); if (c.geometry) c.geometry.dispose(); });
  }
  function showGuides(guides, z, frame) {
    clearGuides();
    const pts = [];
    for (const g of guides || []) {
      const a = g.axis === 'x' ? [g.value, g.from] : [g.from, g.value];
      const b = g.axis === 'x' ? [g.value, g.to] : [g.to, g.value];
      pts.push(worldOf(a, z, frame), worldOf(b, z, frame));
    }
    if (pts.length) {
      const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), guideMat);
      ls.renderOrder = 12; ls.raycast = () => {};
      guideGroup.add(ls);
    }
    C.scene.requestRender();
  }
  function setLabel(text, guides, cx, cy) {
    const hh = host();
    if (!hh) return;
    if (!labelEl) { labelEl = h('div', { class: 'hdl-dim', role: 'status' }); }
    if (labelEl.parentNode !== hh) hh.append(labelEl);
    labelEl.hidden = false;
    labelEl.textContent = text;
    const g = (guides || []).find((x) => x && x.label);
    if (g) labelEl.textContent = `${text}, ${g.label}`;
    const r = hh.getBoundingClientRect();
    labelEl.style.left = `${clamp(cx - r.left + 18, 60, r.width - 100)}px`;
    labelEl.style.top = `${clamp(cy - r.top - 30, 16, r.height - 16)}px`;
  }

  /* ---- drawing the grips ---- */
  function ensureEl(g) {
    let el = els[g.id];
    if (el) return el;
    el = h('div', { class: 'hdl', role: 'button', tabindex: '0', 'data-handle': g.id, 'aria-label': HANDLE_TEXT[g.id] || g.id, title: HANDLE_TEXT[g.id] || g.id });
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      if (!begin(g.id, ev.clientX, ev.clientY, { touch: ev.pointerType !== 'mouse' })) return;
      const ok = C.input.start({
        down() {}, move(e) { queueMove(e.clientX, e.clientY, e.altKey); },
        up(e) { flush(); end(true); }, cancel() { end(false); },
      }, ev);
      if (!ok) { end(false); return; }
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events have no active pointer */ }
    });
    els[g.id] = el;
    return el;
  }
  function sync() {
    const hh = host();
    if (!hh) return;
    const show = on && sel && valid(sel) && !!T.D().ok;
    const present = new Set();
    if (show) {
      const rect = hh.getBoundingClientRect();
      const fwd = new THREE.Vector3();
      C.scene.camera().getWorldDirection(fwd);
      const elevation = Math.abs(fwd.y) < 0.35;
      for (const g of gripsOf(sel)) {
        if (drag && drag.id !== g.id) continue;
        if (g.kind === 'rotate' && elevation) continue;
        const p = C.scene.toScreen(worldOf(g.at, g.z, g.frame));
        if (!p.visible) continue;
        const el = ensureEl(g);
        if (el.parentNode !== hh) hh.append(el);
        el.hidden = false;
        el.style.transform = `translate(${(p.x - rect.left).toFixed(1)}px, ${(p.y - rect.top).toFixed(1)}px)`;
        el.classList.toggle('active', !!drag && drag.id === g.id);
        present.add(g.id);
      }
    }
    for (const id of Object.keys(els)) if (!present.has(id)) { els[id].hidden = true; }
    if (!drag && labelEl) labelEl.hidden = true;
  }
  C.scene.onFrame(() => { if (on && sel) sync(); });

  /* ---- drag ---- */
  const snapSettings = () => { const sn = S().view.snap || {}; return { on: sn.on !== false, grid: sn.grid === 5 ? 5 : 1 }; };

  function begin(id, cx, cy, opt = {}) {
    if (drag) end(true);
    if (!on || !sel || !valid(sel)) return false;
    const g = gripsOf(sel).find((x) => x.id === id);
    if (!g) return false;
    const fp = boxOf(sel);
    if (!fp) return false;
    const p0 = pointerPoint(cx, cy, g.z, g.frame);
    if (!p0) return false;
    const frame = fp.frame;
    const ppf = pxPerFt(sel, g);
    drag = {
      id, item: { ...sel }, grip: g, frame, fp, p0, orig: {}, pending: null, raf: 0, touch: !!opt.touch,
      targets: frame === 'layout' ? layoutTargets(sel.kind === 'core' ? sel : null) : localTargets(),
      tol: clamp((opt.touch ? TOL_PX_TOUCH : TOL_PX) / ppf, 0.5, 20),
      base: clone(T.store.get(basePath(sel))),
      strip: D().raw.strip, frameW: D().raw.frame.W, frameD: D().raw.frame.D,
    };
    last = { id, label: '', guides: [] };
    C.scene.setOrbitEnabled(false);
    sync();
    return true;
  }
  function queueMove(cx, cy, alt) {
    if (!drag) return;
    drag.pending = { cx, cy, alt };
    if (!drag.raf) drag.raf = requestAnimationFrame(() => { if (drag) drag.raf = 0; flush(); });
  }
  function flush() {
    if (!drag || !drag.pending) return;
    const { cx, cy, alt } = drag.pending;
    drag.pending = null;
    move(cx, cy, !!alt);
  }
  function write(path, value) {
    if (!(path in drag.orig)) drag.orig[path] = clone(T.store.get(path));
    T.store.set(path, value, { live: true });
  }

  function move(cx, cy, alt) {
    if (!drag) return null;
    const sn = snapSettings();
    const enabled = sn.on && !alt;
    const it = drag.item, id = drag.id, base = drag.base, g = drag.grip;
    const bp = basePath(it);
    if (!bp) return last;
    const P = pointerPoint(cx, cy, g.z, drag.frame);
    if (!P) return last;
    const dx = P[0] - drag.p0[0], dy = P[1] - drag.p0[1];
    const box = drag.fp.box;
    const tolOpts = { tolerance: drag.tol, grid: sn.grid, enabled };
    let label = '', guides = [];
    const moveBox = (b, d) => {
      const res = SnapMod.snapMove(b, d, drag.targets, tolOpts);
      return { dx: enabled ? res.dx : rnd(d.dx, 10), dy: enabled ? res.dy : rnd(d.dy, 10), guides: res.guides.filter((q) => q.kind !== 'grid') };
    };

    if (it.kind === 'footprint') {
      if (id === 'move') {
        const r = moveBox(box, { dx, dy });
        guides = r.guides;
        const x = r4(num(base.x, 0) + r.dx), y = r4(num(base.y, 0) + r.dy);
        write(`${bp}.x`, x); write(`${bp}.y`, y);
        label = `Center ${fmt(x)}, ${fmt(y)}`;
      } else if (id === 'rotate') {
        const off = (Math.atan2(num(base.depth, 1), num(base.width, 1)) * 180) / Math.PI;
        let ang = (Math.atan2(P[1] - num(base.y, 0), P[0] - num(base.x, 0)) * 180) / Math.PI - off;
        ang = enabled ? Math.round(ang / 5) * 5 : Math.round(ang * 10) / 10;
        while (ang > 180) ang -= 360;
        while (ang <= -180) ang += 360;
        write(`${bp}.angle`, ang);
        label = `Angle ${ang} deg`;
      } else {
        const isW = id === 'width';
        const a = (num(base.angle, 0) * Math.PI) / 180;
        const dir = isW ? [Math.cos(a), Math.sin(a)] : [-Math.sin(a), Math.cos(a)];
        const e0 = isW ? num(base.width, 0) : num(base.depth, 0);
        const t = dx * dir[0] + dy * dir[1];
        const ext = clamp(SnapMod.snapLength(e0 + t, { step: enabled ? 1 : 0.1 }), 20, MAXD);
        const shift = (ext - e0) / 2;
        write(`${bp}.${isW ? 'width' : 'depth'}`, r4(ext));
        write(`${bp}.x`, r4(num(base.x, 0) + dir[0] * shift));
        write(`${bp}.y`, r4(num(base.y, 0) + dir[1] * shift));
        label = `${isW ? 'Width' : 'Depth'} ${fmt(ext)}`;
      }
    } else if (it.kind === 'core') {
      const r = moveBox(box, { dx, dy });
      guides = r.guides;
      const x = r4(num(base.x, 0) + r.dx), y = r4(num(base.y, 0) + r.dy);
      write(`${bp}.x`, x); write(`${bp}.y`, y);
      label = `Core ${fmt(x)}, ${fmt(y)}`;
    } else if (it.kind === 'entry') {
      const alongY = base.side === 'west' || base.side === 'east';
      const ax = alongY ? 'y' : 'x';
      const r = moveBox(box, ax === 'x' ? { dx, dy: 0 } : { dx: 0, dy });
      guides = r.guides.filter((q) => q.axis === ax);
      const delta = ax === 'x' ? r.dx : r.dy;
      const wdt = num(base.width, 24), len = alongY ? drag.frameD : drag.frameW;
      const at = clamp(r4(num(base.at, 0) + delta), Math.min(wdt / 2, len / 2), Math.max(len - wdt / 2, len / 2));
      write(`${bp}.at`, at);
      label = `Entry at ${fmt(at)}`;
    } else if (id === 'move') {
      const bw = box.maxX - box.minX, bd = box.maxY - box.minY;
      const r = moveBox(box, { dx, dy });
      guides = r.guides;
      let x = num(base.x, 0) + r.dx, y = num(base.y, 0) + r.dy;
      if (drag.strip && drag.strip.y1 - drag.strip.y0 >= bd - 0.001) y = clamp(y, drag.strip.y0, drag.strip.y1 - bd);
      x = clamp(x, 0, Math.max(0, drag.frameW - bw));
      write(`${bp}.x`, r4(x)); write(`${bp}.y`, r4(y));
      label = `Ramp ${fmt(x)}, ${fmt(y)}`;
    } else {
      const T0 = RampsMod.speedRampFootprint({ ...S(), ramp: { ...S().ramp, speed: base } });
      const tr = T0 ? (T0.box[2] - T0.box[0]) - num(base.length, 0) : 0;
      const r = SnapMod.snapEdge(box.maxX + dx, 'x', drag.targets, { tolerance: drag.tol, grid: 0, enabled, span: { from: box.minY, to: box.maxY } });
      let L = r.value - box.minX - tr;
      if (!r.guide) L = SnapMod.snapLength(L, { step: enabled ? 1 : 0.1 });
      if (r.guide && r.guide.kind !== 'grid') guides = [r.guide];
      L = clamp(L, 20, Math.max(20, Math.min(400, drag.frameW - num(base.x, 0) - tr)));
      write(`${bp}.length`, r4(L));
      label = `Length ${fmt(L)}`;
    }
    last = { id, label, guides: guides.map((q) => ({ axis: q.axis, value: q.value, kind: q.kind, label: q.label })) };
    showGuides(guides, g.z, drag.frame);
    setLabel(label, guides, cx, cy);
    return last;
  }
  function end(ok = true) {
    if (!drag) return;
    const d = drag;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag = null;
    if (!ok) for (const [path, v] of Object.entries(d.orig)) T.store.set(path, v, { live: true });
    T.store.commit();
    C.scene.setOrbitEnabled(true);
    clearGuides();
    if (labelEl) labelEl.hidden = true;
    C.scene.requestRender();
    sync();
  }

  /* ---- selection ---- */
  function onSelection(e) {
    const item = e && e.item;
    const next = e && e.owner === 'parking' && item && KINDS.includes(item.kind) ? { kind: item.kind, id: item.kind === 'footprint' ? 'footprint' : item.pid } : null;
    if (drag && !same(sel, next)) end(false);
    sel = next;
    sync();
    if (T.gizmo) T.gizmo.sync();
  }
  function deleteSelected() {
    if (!on || !sel || (sel.kind !== 'core' && sel.kind !== 'entry')) return false;
    return T.deleteItem(sel);
  }

  return {
    sync,
    setOn(v) { on = !!v; if (!on) { if (drag) end(false); sel = null; } sync(); },
    onSelection,
    hasSelection: () => !!(sel && valid(sel)),
    selection: () => (sel ? { ...sel } : null),
    deleteSelected,
    visible: () => Object.keys(els).filter((id) => els[id] && !els[id].hidden),
    /** Test hooks: the same drag math as a real drag, driven by plan feet in the item's frame instead of pointer events. */
    select(it) { sel = it ? { kind: it.kind, id: it.id === undefined ? 'footprint' : it.id } : null; sync(); if (T.gizmo) T.gizmo.sync(); },
    grips: () => (sel && valid(sel) ? gripsOf(sel).map((g) => ({ ...g, world: worldOf(g.at, g.z, g.frame).toArray() })) : []),
    simulate(id, a = 0, b = 0, opts = {}) {
      if (!sel || !valid(sel)) return null;
      const g = gripsOf(sel).find((x) => x.id === id);
      if (!g) return null;
      const p0 = C.scene.toScreen(worldOf(g.at, g.z, g.frame));
      if (!begin(id, p0.x, p0.y, { touch: !!opts.touch })) return null;
      let target;
      if (id === 'rotate') {
        const f = S().footprint;
        const off = Math.atan2(num(f.depth, 1), num(f.width, 1));
        const rad = (a * Math.PI) / 180 + off, R = 100;
        target = [num(f.x, 0) + R * Math.cos(rad), num(f.y, 0) + R * Math.sin(rad)];
      } else target = [g.at[0] + a, g.at[1] + b];
      const p1 = C.scene.toScreen(worldOf(target, g.z, g.frame));
      const res = move(p1.x, p1.y, !!opts.alt);
      if (!opts.hold) end(true);
      return res;
    },
    release(ok = true) { end(ok); },
    last: () => last,
  };
}
