/* ==========================================================================
   TOWER: project glue
   Port of build/tower/09b_project.js for the shared app project (ctx.project).
   - reads the site and the grading floor from the project (derived only)
   - placement on the site, the base elevation that follows the ground, context from the site
   - writes the "massing" section after committed changes (debounced), reads it back on open and on a change from outside
   - a massing written by another tool (the Mid-Rise Generator) is kept until the user confirms the replacement
   The tower state lives in the tool store (ctx.store). The project section holds a copy (docs/project-file-spec.md 6.2).
   ========================================================================== */
import { towerDerived } from '../../../src/tower/derived.js';
import { siteContextFor, toProject, transformRing } from '../../../src/shared/project.js';
import { CONFIG, num, deepClone, fillDefaults, migrateTower, defaultState } from './state.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r1 = (v) => Math.round(v * 10) / 10;
const ZERO = () => ({ x: 0, y: 0, rotation: 0, baseZ: 0 });
export const TOOL_NAMES = { midrise: 'Mid-Rise Generator', tower: 'Tower Generator', plate: 'Plate Planner', parking: 'Parking Deck', facade: 'Facade Studio', grading: 'Grading Sketch', site: 'Site Model' };

export function createProject(T) {
  const { ctx, store } = T;
  const P = ctx.project;
  const flags = { loading: false, timer: 0, dirty: false, seen: null, keepManual: false, asking: false, confirmed: false, declined: false, noted: {} };

  const note = (key, text, kind = 'warn', ms = 8000) => {
    if (flags.noted[key]) return;
    flags.noted[key] = true;
    ctx.ui.Toast.show(text, { kind, ms });
  };

  /* ---- reading ---- */
  const sec = (key) => { try { return P.section(key); } catch (e) { return null; } };
  const hasDoc = () => { try { return !!P.doc(); } catch (e) { return false; } };
  const placement = () => {
    const p = store.raw().placement;
    return isObj(p) ? { x: num(p.x, 0), y: num(p.y, 0), rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : ZERO();
  };
  const baseMode = () => { const p = store.raw().placement; return isObj(p) && p.baseMode === 'typed' ? 'typed' : 'follow'; };
  const pinned = () => { const p = store.raw().placement; return isObj(p) && p.pinned === true; };

  /** The site of the project: { size, boundary (project frame), center, bounds } or null. */
  function siteInfo() {
    const s = sec('site');
    if (!s || !isObj(s.derived)) return null;
    const dv = s.derived;
    const doc = P.doc();
    const frame = (doc && doc.frame) || {};
    const S = num(dv.size, num(frame.size, 0));
    let boundary = Array.isArray(dv.boundary) && dv.boundary.length >= 3 ? dv.boundary : null;
    if (!boundary && S > 0) boundary = [[0, 0], [S, 0], [S, S], [0, S]];
    if (!boundary) return null;
    let ring = boundary;
    try { ring = transformRing(s, boundary, 'toProject'); } catch (e) { ring = boundary; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
    return { size: S, boundary: ring, center: [(minX + maxX) / 2, (minY + maxY) / 2], updatedAt: s.updatedAt || '' };
  }
  const hasSite = () => !!siteInfo();

  /** Grading Sketch tier of this building: { ffe, id } or null (the lowest tier that came from the massing). Read from the project, so it does not need the Grading tool. */
  function gradingFfe() {
    const g = sec('grading');
    const list = g && isObj(g.derived) && Array.isArray(g.derived.ffe) ? g.derived.ffe : [];
    let best = null;
    for (const t of list) {
      if (!isObj(t) || t.source !== 'massing' || !Number.isFinite(t.ffe)) continue;
      const tier = num(t.tier, 1);
      if (!best || tier < best.tier || (tier === best.tier && t.ffe < best.ffe)) best = { ffe: t.ffe, id: t.id, tier };
    }
    return best ? { ffe: best.ffe, id: best.id } : null;
  }

  /* ---- ground under the footprint ---- */
  function groundUnderFootprint(pl = placement(), bounds) {
    let b = bounds;
    if (!b) { try { b = T.derived.get().bounds.model; } catch (e) { b = null; } }
    if (!b || ![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) return null;
    const N = 9;
    let low = Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = toProject(pl, [b.minX + ((b.maxX - b.minX) * i) / (N - 1), b.minY + ((b.maxY - b.minY) * j) / (N - 1)]);
      let z = null;
      try { z = ctx.ground.at(p[0], p[1]); } catch (e) { z = null; }
      if (Number.isFinite(z) && z < low) low = z;
    }
    return Number.isFinite(low) ? r1(low) : null;
  }
  const followsGround = () => hasDoc() && isObj(store.raw().placement) && baseMode() === 'follow';

  /** The base elevation Follow ground wants: the Grading Sketch FFE of this building, else the lowest ground under the footprint (the parking rule). */
  function followTarget() {
    const tier = gradingFfe();
    return tier ? tier.ffe : groundUnderFootprint();
  }

  /** Sets placement.baseZ to the grading FFE, else the lowest ground under the footprint (Follow ground). merge: no new undo step. Returns true when it changed. */
  function followGround({ merge = false } = {}) {
    if (!followsGround() || store.gestureActive()) return false;
    const z = followTarget();
    if (z == null || Math.abs(z - placement().baseZ) < 1e-9) return false;
    const was = flags.loading;
    flags.loading = true;
    try {
      store.set('placement.baseZ', z, { live: false, merge });
      if (store.raw().context && store.raw().context.fromSite) contextFromSite(undefined, { quiet: true, merge: true, follow: false });
    } finally { flags.loading = was; }
    if (!was) markDirty();
    return true;
  }
  function setBaseMode(mode) {
    if (!isObj(store.raw().placement) || (mode !== 'follow' && mode !== 'typed') || baseMode() === mode) return false;
    store.set('placement.baseMode', mode, { live: false });
    if (mode === 'follow') followGround({ merge: true });
    return true;
  }

  /* ---- placement and context ---- */
  function siteBlocks(pl, radius, keepManual, current) {
    let res;
    try { res = siteContextFor(P.doc(), pl, radius); } catch (e) { console.error(e); return null; }
    let blocks = res.blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d, h: b.h, base: b.base, site: true }));
    let trimmed = 0;
    if (blocks.length > CONFIG.maxContext) {
      blocks.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      trimmed = blocks.length - CONFIG.maxContext;
      blocks = blocks.slice(0, CONFIG.maxContext);
    }
    if (keepManual) blocks = [...(current || []).filter((b) => b && !b.site).map((b) => ({ ...b })), ...blocks];
    return { blocks, trimmed };
  }

  /** Puts the tower at the site center, ground floor on the ground there. One undo step. */
  function centerOnSite({ quiet = false } = {}) {
    const info = siteInfo();
    if (!info) { if (!quiet) ctx.ui.Toast.show('This project has no site yet. Load a site first.', { kind: 'warn' }); return false; }
    let z = null;
    try { z = ctx.ground.at(info.center[0], info.center[1]); } catch (e) { z = null; }
    const cur = placement();
    const typed = baseMode() === 'typed';
    const next = { ...(isObj(store.raw().placement) ? store.raw().placement : {}), x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: cur.rotation, baseZ: z == null || typed ? cur.baseZ : Math.round(z * 10) / 10, baseMode: baseMode() };
    const st = deepClone(store.raw());
    st.placement = next;
    if (st.context && st.context.fromSite) {
      const r = siteBlocks(next, num(st.context.radius, CONFIG.contextRadius), flags.keepManual, st.context.blocks);
      if (r) st.context.blocks = r.blocks;
    }
    store.replace(st);
    followGround({ merge: true });
    if (!quiet) ctx.ui.Toast.show('Centered on the site.');
    return true;
  }

  /** The site buildings near the tower become context blocks (fromSite). Returns the count, or -1. */
  function contextFromSite(radius, { quiet = false, merge = false, keepManual, follow = true } = {}) {
    if (!hasDoc()) { if (!quiet) ctx.ui.Toast.show('Open a project first.', { kind: 'warn' }); return -1; }
    if (!hasSite()) { if (!quiet) ctx.ui.Toast.show('This project has no site, so there are no neighbors to load.', { kind: 'warn' }); return -1; }
    const r = Number.isFinite(radius) && radius > 0 ? radius : num(store.get('context.radius'), CONFIG.contextRadius);
    const cur = store.raw().context;
    const res = siteBlocks(placement(), r, keepManual === undefined ? flags.keepManual : !!keepManual, cur.blocks);
    if (!res) { ctx.ui.Toast.show('The neighbors could not be read from the site.', { kind: 'error' }); return -1; }
    store.set('context', { ...deepClone(cur), blocks: res.blocks, fromSite: true, show: true, radius: r }, { live: false, merge });
    const n = res.blocks.filter((b) => b.site).length;
    if (follow) followGround({ merge: true });
    if (!quiet) ctx.ui.Toast.show(n ? `Loaded ${n} neighbor${n === 1 ? '' : 's'} within ${Math.round(r)} ft.${res.trimmed ? ` ${res.trimmed} farther ones were left out.` : ''}` : `No site buildings within ${Math.round(r)} ft.`);
    return n;
  }

  /** A new design in an open project starts at the site center on the ground there, with the site neighbors as context. */
  function prepareNew(st) {
    if (!hasDoc()) return st;
    const info = siteInfo();
    if (!info) { st.placement = { ...ZERO(), baseMode: 'follow' }; if (st.context) st.context.fromSite = false; return st; }
    let z = null;
    try { z = ctx.ground.at(info.center[0], info.center[1]); } catch (e) { z = null; }
    const tier = gradingFfe();
    st.placement = { x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: 0, baseZ: tier ? tier.ffe : z == null ? 0 : Math.round(z * 10) / 10, baseMode: 'follow' };
    if (st.context) {
      const r = num(st.context.radius, CONFIG.contextRadius);
      const res = siteBlocks(st.placement, r, false, []);
      if (res) Object.assign(st.context, { blocks: res.blocks, fromSite: true, show: true, radius: r });
    }
    return st;
  }

  /* ---- ownership of the massing section ---- */
  const hasContent = (s) => isObj(s) && ((isObj(s.state) && Object.keys(s.state).length > 0) || (isObj(s.derived) && Object.keys(s.derived).length > 0));
  /** The id of another tool whose massing the project holds, or null (no massing, or the tower's own). */
  function foreignTool() {
    const s = sec('massing');
    return s && s.tool && s.tool !== CONFIG.tool && hasContent(s) ? s.tool : null;
  }
  const owned = () => !foreignTool();
  const stampOf = (s) => (s && typeof s.updatedAt === 'string' ? s.updatedAt : null);
  const towerSection = (s) => !!s && s.tool === CONFIG.tool && isObj(s.state) && Object.keys(s.state).length > 0;

  /** The tower state a massing section holds, ready for the store. */
  function stateFrom(s) {
    let st = deepClone(s.state);
    if (!(st.schema >= 2)) st = migrateTower(st, Number(st.schema) || 1);
    return fillDefaults({ ...st, placement: isObj(s.placement) ? s.placement : ZERO() });
  }
  /** Puts a state on screen without a save of its own. */
  function show(st, { resetHistory = true } = {}) {
    const was = flags.loading;
    flags.loading = true;
    try { store.replace(st, { resetHistory }); } finally { flags.loading = was; }
  }

  /** The placement of a foreign massing, to start the tower where that massing stands. */
  function foreignPlacement() {
    const s = sec('massing');
    return s && isObj(s.placement) ? { x: num(s.placement.x, 0), y: num(s.placement.y, 0), rotation: num(s.placement.rotation, 0), baseZ: num(s.placement.baseZ, 0) } : null;
  }

  /* ---- writing ---- */
  function sectionPatch() {
    const st = store.snapshot();
    st.sun.play = false;
    const d = T.derived.get();
    const derived = towerDerived(st, d, d.metrics);
    const pl = { ...placement(), baseMode: baseMode() };
    if (pinned()) pl.pinned = true;
    return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: pl, state: { ...st, placement: pl }, derived, note: st.name };
  }
  function markDirty() {
    if (!hasDoc() || flags.loading) return;
    flags.dirty = true;
    clearTimeout(flags.timer);
    flags.timer = setTimeout(() => flush(), CONFIG.projectSaveMs);
  }
  /** Writes the massing section now. Returns true when written. */
  function flush({ force = false } = {}) {
    clearTimeout(flags.timer);
    flags.timer = 0;
    if (!flags.dirty && !force) return false;
    if (!hasDoc() && !force) return false;
    if (foreignTool() && !flags.confirmed) return false;  // the question was not answered: the other massing stays
    if (P.isReadOnly && P.isReadOnly('massing')) { note('readonly', 'This project was saved by a newer version. Changes are not saved.'); flags.dirty = false; return false; }
    let patch;
    try { patch = sectionPatch(); } catch (e) {
      console.error(e);
      ctx.ui.Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error', ms: 8000 });
      return false;
    }
    let ok = false;
    try { ok = !!P.write('massing', patch); } catch (e) {
      if (e && e.readOnly) note('readonly', e.message || 'This project was saved by a newer version. Changes are not saved.');
      else { console.error(e); ctx.ui.Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error', ms: 8000 }); }
    }
    flags.dirty = false;
    flags.seen = stampOf(sec('massing'));
    if (ok) flags.confirmed = false;
    return ok;
  }

  /** Asks to replace a massing from another tool. Resolves true when the user agrees. */
  async function askReplace() {
    const other = TOOL_NAMES[foreignTool()] || 'another tool';
    if (flags.asking) return false;
    flags.asking = true;
    let ok = false;
    try {
      ok = await ctx.ui.confirmDialog({
        title: 'Replace the massing?',
        body: `This project holds a massing from the ${other}. Saving here replaces it with this tower.`,
        ok: 'Replace', cancel: 'Keep it',
      });
    } finally { flags.asking = false; }
    return !!ok;
  }

  /* ---- loading ---- */
  /**
   * Takes the tower from the project when its massing is the tower's, else starts the working copy at the site.
   * startup: the first load of this tool (the saved working copy may be used).
   * Returns 'mine' | 'new' | 'foreign'.
   */
  function load({ working } = {}) {
    const s = sec('massing');
    if (towerSection(s)) {
      show(stateFrom(s));
      flags.seen = stampOf(s);
      return 'mine';
    }
    const foreign = foreignTool();
    const base = fillDefaults(working || store.raw() || defaultState());
    if (foreign) {
      const fp = foreignPlacement();
      base.placement = fp ? { ...fp, baseMode: 'typed' } : { ...ZERO(), baseMode: 'follow' };
      show(base);
      flags.seen = stampOf(s);
      return 'foreign';
    }
    // a project with no massing: start at the site center on the ground there
    if (hasDoc()) {
      prepareNew(base);
      show(base);
    } else {
      base.placement = null;
      if (base.context) base.context.fromSite = false;
      show(base);
    }
    flags.seen = null;
    return 'new';
  }

  /** The stored massing changed from outside (another page, another tool). Takes it when it is the tower's. */
  function sync() {
    const s = sec('massing');
    if (towerSection(s)) {
      if (stampOf(s) !== flags.seen && !store.gestureActive()) {
        flags.seen = stampOf(s);
        flags.dirty = false;
        show(stateFrom(s), { resetHistory: false });
        return true;
      }
    }
    return false;
  }

  /** Forgets the project: the working copy has no placement. */
  function detach() {
    flags.dirty = false;
    clearTimeout(flags.timer);
    flags.seen = null;
    const cur = deepClone(store.raw());
    cur.placement = null;
    if (cur.context) cur.context.fromSite = false;
    show(cur, { resetHistory: true });
  }

  return {
    flags, sec, hasDoc, placement, baseMode, pinned, siteInfo, hasSite, gradingFfe,
    groundUnderFootprint, followGround, setBaseMode, centerOnSite, contextFromSite, prepareNew,
    foreignTool, owned, towerSection, stateFrom, show, sectionPatch, markDirty, flush, askReplace, load, sync, detach, foreignPlacement,
  };
}
