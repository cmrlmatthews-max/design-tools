/* ==========================================================================
   PROJECT FILE  (docs/project-file-spec.md sections 8, 10 and 12; docs/tower-project-sun-plan.md sections 3.2, 5.2 and 7)
   `ProjectUI` is the glue between the page and src/shared/project.js (ProjectMod).
   With ?project=<id> the page opens that project, loads its "massing" section when the Tower Generator wrote it, and writes
   that section back after every change (1 s debounce, and on visibilitychange / pagehide). The "sun" section is written in the
   same save when the Sun Study is on (state.sun.mode === "study") or a sun-hours result exists (writeSun below).
   Without a project nothing here runs until the Project menu or a Send item is used.
   A massing written by another tool (the Mid-Rise Generator) is kept until you confirm the replacement.
   ProjectMod.writeSection returns a new project and does not change the one it gets. So a save loads the project fresh from
   storage, writes the sections on that copy and saves it (another tool may have saved from a second tab).
   Every storage call is inside try/catch. Tests inject storage, navigation and the address bar with configure().
   ========================================================================== */
const ProjectUI = (() => {
  const $ = (id) => document.getElementById(id);
  const ZERO = () => ({ x: 0, y: 0, rotation: 0, baseZ: 0 });
  const READ_ONLY_TEXT = 'This project was saved by a newer version of this tool. You can view it, but changes will not be saved.';
  const NO_STORAGE_TEXT = 'Saving is unavailable in this browser, so the project is kept only until you close this page.';
  const MAX_CONTEXT = 300;
  const TOOL_NAMES = { midrise: 'Mid-Rise', tower: 'Tower', plate: 'Plate Planner', parking: 'Parking Deck', facade: 'Facade Studio', grading: 'Grading Sketch' };
  const SEND_TOOLS = ['plate', 'parking', 'facade', 'grading'];
  const project = {
    doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {},
    replaceNeeded: false, replaceTool: null, confirmed: false, asking: false, renamed: null,
    keepManual: false,           // "Keep manual blocks" next to Context from site
    sunHours: null,              // the sun-hours payload written into the sun section (null = none)
    storage: null,
    navigate: (url) => { window.location.assign(url); },
    updateUrl: (id) => {
      try {
        const u = new URL(window.location.href);
        if (id) u.searchParams.set('project', id); else u.searchParams.delete('project');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* the address bar is a convenience */ }
    },
  };
  const DEFAULT_NAV = project.navigate, DEFAULT_URL = project.updateUrl;
  const isObjP = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toolName = (id) => TOOL_NAMES[id] || 'another tool';

  function storageOf() {
    if (project.storage) return project.storage;
    try { return window.localStorage; } catch (e) { return null; }
  }
  function noticeOnce(key, message, kind = 'warn', ms = 9000) {
    if (project.noted[key]) return;
    project.noted[key] = true;
    Toast.show(message, kind, ms);
  }
  const storageNotice = () => ({ onNotice: (message) => noticeOnce(`storage:${message}`, String(message)) });

  /* ---- reading the project ------------------------------------------------------------------ */
  const has = () => !!project.doc;
  function sectionOf(key) {
    if (!project.doc) return null;
    try { return ProjectMod.getSection(project.doc, key); } catch (e) { return null; }
  }
  const placement = () => {
    const p = Store.raw().placement;
    return isObjP(p) ? { x: num(p.x, 0), y: num(p.y, 0), rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : ZERO();
  };

  /** The site of the project: { size, boundary (project frame), center, ground, updatedAt } or null. */
  function siteInfo() {
    const sec = sectionOf('site');
    if (!sec || !isObjP(sec.derived)) return null;
    const dv = sec.derived, frame = (project.doc && project.doc.frame) || {};
    const S = num(dv.size, num(frame.size, 0));
    let boundary = Array.isArray(dv.boundary) && dv.boundary.length >= 3 ? dv.boundary : null;
    if (!boundary && S > 0) boundary = [[0, 0], [S, 0], [S, S], [0, S]];
    if (!boundary) return null;
    let ring = boundary;
    try { ring = ProjectMod.transformRing(sec, boundary, 'toProject'); } catch (e) { ring = boundary; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
    return { size: S, boundary: ring, center: [(minX + maxX) / 2, (minY + maxY) / 2], ground: isObjP(dv.ground) ? dv.ground : null, updatedAt: sec.updatedAt || '' };
  }
  const hasSite = () => !!siteInfo();

  /** The place of the site: { lat, lon } from the project frame (or the site section), or null. For the Sun section's "Site" place. */
  function sitePlace() {
    if (!project.doc || !hasSite()) return null;
    const frame = project.doc.frame || {}, dv = (sectionOf('site') || {}).derived || {};
    const lat = Number.isFinite(frame.lat) ? frame.lat : dv.lat, lon = Number.isFinite(frame.lon) ? frame.lon : dv.lon;
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  /** The ground elevation (project frame, ft) at a project point: bilinear on the site grid. null without a grid. */
  function groundAt(xp, yp) {
    const sec = sectionOf('site');
    return sec && isObjP(sec.derived) ? SiteLayerMod.groundZAt(sec.derived, xp, yp) : null;
  }

  /** The Grading Sketch tier that sets the ground floor of the massing: { ffe, source, id } or null (spec section 4: the lowest tier). */
  function gradingFfe() {
    const sec = sectionOf('grading');
    const list = sec && isObjP(sec.derived) && Array.isArray(sec.derived.ffe) ? sec.derived.ffe : [];
    let best = null;
    for (const t of list) if (isObjP(t) && t.source === 'massing' && Number.isFinite(t.ffe) && (!best || t.ffe < best.ffe)) best = { ffe: t.ffe, source: t.source, id: t.id };
    return best;
  }

  /** The site boundary in the building's own (local) frame, for the renderer. null without a site. */
  let bCache = { key: null, ring: null };
  const clearBoundary = () => { bCache = { key: null, ring: null }; };
  function boundaryKey() {
    if (!project.doc) return '';
    const info = siteInfo();
    if (!info) return 'none';
    return `${info.updatedAt}|${JSON.stringify(placement())}`;
  }
  function boundaryLocal() {
    const key = boundaryKey();
    if (!key || key === 'none') return null;
    if (bCache.key === key) return bCache.ring;
    let ring = null;
    try { ring = ProjectMod.transformRing(placement(), siteInfo().boundary, 'toLocal'); } catch (e) { ring = null; }
    bCache = { key, ring };
    return ring;
  }

  /* ---- placement and context ----------------------------------------------------------------- */
  /** Neighbor blocks from the site for a placement and radius, as context blocks. { blocks, trimmed } or null on an error. */
  function siteBlocks(pl, radius, keepManual, current) {
    let res;
    try { res = ProjectMod.siteContextFor(project.doc, pl, radius); } catch (e) { console.error(e); return null; }
    let blocks = res.blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d, h: b.h, base: b.base, site: true }));
    let trimmed = 0;
    if (blocks.length > MAX_CONTEXT) {
      blocks.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      trimmed = blocks.length - MAX_CONTEXT;
      blocks = blocks.slice(0, MAX_CONTEXT);
    }
    if (keepManual) blocks = [...(current || []).filter((b) => b && !b.site).map((b) => ({ ...b })), ...blocks];
    return { blocks, trimmed };
  }

  /** Puts the tower at the site center, with its ground floor at the ground there. One undo step (the neighbors follow in the same step). */
  function centerOnSite({ quiet = false } = {}) {
    const info = siteInfo();
    if (!info) { if (!quiet) Toast.show('This project has no site yet. Send a site from the Site Model first.', 'warn'); return false; }
    const z = groundAt(info.center[0], info.center[1]);
    const cur = placement();
    const typed = baseMode() === 'typed';
    const next = { ...(isObjP(Store.raw().placement) ? Store.raw().placement : {}), x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: cur.rotation, baseZ: z == null || typed ? cur.baseZ : Math.round(z * 10) / 10, baseMode: baseMode() };
    const st = deepClone(Store.raw());
    st.placement = next;
    if (st.context && st.context.fromSite) {
      const r = siteBlocks(next, num(st.context.radius, CONFIG.contextRadius), project.keepManual, st.context.blocks);
      if (r) st.context.blocks = r.blocks;
    }
    Store.replace(st);
    followGround({ merge: true });                     // the base follows the lowest ground under the footprint (the Store hook has done it already)
    if (!quiet) Toast.show(z == null || typed ? 'Centered on the site.' : `Centered on the site. Ground floor at ${Units.formatFeetInches(placement().baseZ)} above sea level.`);
    return true;
  }
  /** A new design inside an open project (Storage.newDesign): the tower starts at the site center, on the ground there, with the
   *  site neighbors as context. With no site, at the project origin on the ground plane. Changes `st` in place (one undo step). */
  function prepareNew(st) {
    if (!project.doc) return st;
    const info = siteInfo();
    if (!info) { st.placement = ZERO(); if (st.context) st.context.fromSite = false; return st; }
    const z = groundAt(info.center[0], info.center[1]);
    st.placement = { x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: 0, baseZ: z == null ? 0 : Math.round(z * 10) / 10 };
    if (st.context) {
      const r = num(st.context.radius, CONFIG.contextRadius);
      const res = siteBlocks(st.placement, r, false, []);
      if (res) Object.assign(st.context, { blocks: res.blocks, fromSite: true, show: true, radius: r });
    }
    return st;
  }
  /** The site buildings near the tower become context blocks (fromSite = true). One undo step. Returns the count, or -1.
   *  opts { quiet, merge (no new undo step when the Store supports it), keepManual (default: the Keep manual blocks toggle) }. */
  function contextFromSite(radius, { quiet = false, merge = false, keepManual, follow = true } = {}) {
    if (!project.doc) { if (!quiet) Toast.show('Open a project first.', 'warn'); return -1; }
    if (!hasSite()) { if (!quiet) Toast.show('This project has no site, so there are no neighbors to load.', 'warn'); return -1; }
    const r = Number.isFinite(radius) && radius > 0 ? radius : num(Store.get('context.radius'), CONFIG.contextRadius);
    const cur = Store.raw().context;
    const res = siteBlocks(placement(), r, keepManual === undefined ? project.keepManual : !!keepManual, cur.blocks);
    if (!res) { Toast.show('The neighbors could not be read from the site.', 'bad'); return -1; }
    Store.set('context', { ...deepClone(cur), blocks: res.blocks, fromSite: true, show: true, radius: r }, { live: false, merge });
    const n = res.blocks.filter((b) => b.site).length;
    if (follow) followGround({ merge: true });         // the neighbors' base is relative to baseZ; followGround refreshes them when the base moves
    if (!quiet) Toast.show(n ? `Loaded ${n} neighbor${n === 1 ? '' : 's'} within ${Units.formatFeetInches(r)}.${res.trimmed ? ` ${res.trimmed} farther ones were left out.` : ''}` : `No site buildings within ${Units.formatFeetInches(r)}.`);
    return n;
  }

  /* ---- the sun section ----------------------------------------------------------------------------- */
  const year = () => new Date().getFullYear();
  const isMD = (s) => typeof s === 'string' && /^\d\d-\d\d$/.test(s);
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  const r2 = (v) => Math.round(v * 100) / 100;

  /** The place of the study: the site (when the project has one and the place says so), typed, or Atlanta. */
  function sunPlace(st) {
    const pl = (st.sun && st.sun.place) || {};
    if (pl.source === 'site') { const sp = sitePlace(); if (sp) return sp; }
    if ((pl.source === 'typed' || pl.source === 'site') && Number.isFinite(pl.lat) && Number.isFinite(pl.lon)) return { lat: pl.lat, lon: pl.lon };
    return { lat: SolarMod.ATLANTA.lat, lon: SolarMod.ATLANTA.lon };
  }
  /** A finished sun-hours result (SunHoursMod output plus grid and date) → the form written into the project, or null. */
  function sunHoursPayload(r) {
    if (!r || !r.hours || !(r.spacing > 0)) return null;
    const len = r.hours.length;
    const nx = Number.isFinite(r.nx) ? r.nx : (Number.isFinite(r.n) ? r.n : Math.round(Math.sqrt(len)));
    const ny = Number.isFinite(r.ny) ? r.ny : (nx > 0 ? len / nx : 0);
    if (!(nx > 0 && ny > 0) || nx * ny !== len) return null;
    const date = isMD(r.date) ? `${year()}-${r.date}` : (typeof r.date === 'string' ? r.date : null);
    return {
      spacing: r.spacing, n: Number.isFinite(r.n) ? r.n : Math.max(nx, ny), nx, ny, x0: num(r.x0, 0), y0: num(r.y0, 0),
      frame: r.frame === 'local' ? 'local' : 'project', date, step: num(r.step, 30),
      hours: Array.from(r.hours, (v) => r2(v)),
    };
  }
  /** sun.derived (spec 6.6 plus the additive keys of plan section 7). */
  function sunDerived(st) {
    const sun = st.sun || {};
    const { lat, lon } = sunPlace(st);
    const tz = isObjP(sun.tz) && sun.tz.zone ? sun.tz : { zone: 'us-eastern', offset: -5 };
    const dates = (Array.isArray(sun.dates) ? sun.dates : []).filter(isMD).map((md) => `${year()}-${md}`);
    const times = (Array.isArray(sun.times) ? sun.times : []).filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
    const samples = [], seen = new Set();
    const add = (date, minutes, always) => {
      const time = hhmm(minutes), key = `${date} ${time}`;
      if (seen.has(key)) return;
      const p = SolarMod.sunPosition(lat, lon, SolarMod.localToUTC(date, minutes, tz));
      if (!always && !(p.altitude > 0)) return;
      seen.add(key);
      samples.push({ date, time, azimuth: r2(p.azimuth), altitude: r2(p.altitude) });
    };
    for (const date of dates) {
      for (const m of times) add(date, m, true);                 // the study sheet: every date x time
      for (let m = 0; m < 1440; m += 60) add(date, m, false);    // each date hourly, daylight only
    }
    return {
      lat, lon, tzOffset: dates.length ? SolarMod.tzOffset(tz, dates[0], 720) : num(tz.offset, -5), zone: tz.zone,
      dates, samples, sunHours: project.sunHours ? deepClone(project.sunHours) : null,
    };
  }
  const sunWanted = () => { const s = Store.raw().sun; return !!project.sunHours || !!(s && s.mode === 'study'); };
  /** The "sun" section patch for the design on screen. */
  function sunPatch() {
    const st = Store.snapshot();
    const state = deepClone(st.sun) || {};
    state.play = false;
    return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: ZERO(), state, derived: sunDerived(st), note: 'sun study' };
  }
  /**
   * For the Sun UI: keeps a finished sun-hours result (SunHoursMod output plus { spacing, n, nx, ny, x0, y0, frame, date, step };
   * hours = Float32Array or array; date "MM-DD" or "YYYY-MM-DD") and writes the "sun" section with it, or with null to clear it.
   * The write happens with the next project save (1 s). Returns true when a project is open to take it.
   */
  function writeSun(result) {
    project.sunHours = result ? sunHoursPayload(result) : null;
    if (!project.doc) return false;
    markDirty();
    return true;
  }
  /** The sun-hours result stored in the open project's sun section (hours as a Float32Array), or null. */
  function sunHoursStored() {
    const sec = sectionOf('sun');
    const sh = sec && isObjP(sec.derived) ? sec.derived.sunHours : null;
    if (!sh || !Array.isArray(sh.hours)) return null;
    return { ...sh, hours: Float32Array.from(sh.hours) };
  }

  /* ---- base elevation: Follow ground or Typed (docs/site-base-style-technical-plan.md section 1) ------------------------------- */
  // A committed change under one of these paths moves the footprint, so followGround runs again.
  const FOOTPRINT_KEYS = ['placement', 'segments', 'podium', 'setbacks', 'carves', 'cuts'];
  const footprintPath = (path) => FOOTPRINT_KEYS.some((k) => path === k || path.startsWith(`${k}.`));
  const r1 = (v) => Math.round(v * 10) / 10;
  /** The base elevation mode of the open design: 'follow' (the default, and an old save) or 'typed'. */
  const baseMode = () => { const p = Store.raw().placement; return isObjP(p) && p.baseMode === 'typed' ? 'typed' : 'follow'; };
  /** site.derived of the open project, or null. */
  function siteDerived() {
    const sec = sectionOf('site');
    return sec && isObjP(sec.derived) ? sec.derived : null;
  }
  /** The lowest ground under the model footprint (project frame, ft NAVD88), or null without a site grid.
   *  A 9 x 9 grid over the plan box of the model, each point turned into the project frame and read from the site ground. Rounded to 0.1 ft. */
  function groundUnderFootprint(pl = placement(), bounds) {
    const dv = siteDerived();
    if (!dv) return null;
    let b = bounds;
    if (!b) { try { b = Derived.get().bounds.model; } catch (e) { b = null; } }
    if (!b || ![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) return null;
    const N = 9;
    let low = Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = ProjectMod.toProject(pl, [b.minX + ((b.maxX - b.minX) * i) / (N - 1), b.minY + ((b.maxY - b.minY) * j) / (N - 1)]);
      const z = SiteLayerMod.groundZAt(dv, p[0], p[1]);
      if (Number.isFinite(z) && z < low) low = z;
    }
    return Number.isFinite(low) ? r1(low) : null;
  }
  /** True when the base elevation follows the ground now: a project is open, the mode is Follow. */
  const followsGround = () => !!project.doc && isObjP(Store.raw().placement) && baseMode() === 'follow';
  /** For the placement gizmo: the base elevation for the moved placement `pl`, or null to leave the base alone. */
  function baseFor(pl) {
    return followsGround() ? groundUnderFootprint(pl) : null;
  }
  /** Sets placement.baseZ to the lowest ground under the footprint when the mode is Follow and the project has a site ground.
   *  opts.merge: no new undo step (the change joins the one before). Returns true when the base changed. */
  function followGround({ merge = false } = {}) {
    if (!followsGround() || Store.gestureActive()) return false;
    const z = groundUnderFootprint();
    if (z == null || Math.abs(z - placement().baseZ) < 1e-9) return false;
    const was = project.loading;
    project.loading = true;                 // the Store hook ignores this write; the context below follows once
    try {
      Store.set('placement.baseZ', z, { live: false, merge });
      if (Store.raw().context && Store.raw().context.fromSite) contextFromSite(undefined, { quiet: true, merge: true, follow: false });
    } finally { project.loading = was; }
    if (!was) markDirty();
    return true;
  }
  /** Follow ground or Typed. Switching to Follow runs followGround once. */
  function setBaseMode(mode) {
    if (!project.doc || !isObjP(Store.raw().placement) || (mode !== 'follow' && mode !== 'typed') || baseMode() === mode) return false;
    Store.set('placement.baseMode', mode, { live: false });
    if (mode === 'follow') followGround({ merge: true });
    return true;
  }
  /** The line under the chips in Follow mode. */
  function baseLineText() {
    const ft = (v) => `${(Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })} ft`;
    const z = placement().baseZ;
    return siteDerived() && groundUnderFootprint() != null ? `Ground floor at ${ft(z)} above sea level.` : `This project has no site ground. The base stays at ${ft(z)}.`;
  }
  /** The base elevation control for the Site tab: Follow ground / Typed chips, a read-only line (Follow) or the typed field (Typed).
   *  lenF = the page's length field maker. Returns a list of elements. */
  function baseControl(lenF) {
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Base elevation mode', id: 'baseModeChips' });
    const btns = [['follow', 'Follow ground'], ['typed', 'Typed']].map(([mode, text]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-base-mode': mode, onclick: () => setBaseMode(mode) }, text);
      chips.append(b);
      return b;
    });
    const line = h('p', { class: 'help', id: 'baseLine' });
    const typed = lenF('Base elevation (ft)', 'placement.baseZ', { hardMin: -1e5, hardMax: 1e5, step: 0.5 });
    return [
      Controls.when(() => { btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.baseMode === baseMode()))); return true; },
        [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Base elevation'), chips)]).el,
      Controls.when(() => { line.textContent = baseLineText(); return baseMode() === 'follow'; }, [line]).el,
      Controls.when(() => baseMode() === 'typed', [typed.el]).el,
      Controls.help('Follow ground sets the base to the lowest ground under the building. Typed keeps the value you enter.'),
    ];
  }

  /* ---- writing the project ---------------------------------------------------------------------- */
  function renderPill() {
    const doc = project.doc, pill = $('projPill');
    if (pill) {
      pill.hidden = !doc;
      if (doc) { pill.textContent = `${doc.name}${project.readOnly ? ' (read only)' : ''}`; pill.title = `Project: ${pill.textContent}`; }
    }
    const line = $('projLine');
    if (line && doc) {
      const info = siteInfo();
      line.textContent = `Project “${doc.name}”${project.readOnly ? ' (read only)' : ''}. ${info ? `Site: ${Units.formatFeetInches(info.size)} square.` : 'No site in this project.'}`;
    }
    const note = $('ctxSiteNote');
    if (note) {
      const n = (Store.raw().context.blocks || []).filter((b) => b && b.site).length;
      note.textContent = Store.raw().context.fromSite ? `${n} block${n === 1 ? '' : 's'} from the site.` : '';
    }
    const ffe = $('ffeNote'), tier = gradingFfe();
    if (ffe) {
      ffe.hidden = !doc;
      ffe.textContent = !doc ? '' : tier
        ? `Grading Sketch sets the ground floor at ${Units.formatFeetInches(tier.ffe)}. The other tools read that height; the base elevation below stays editable.`
        : 'No Grading Sketch height yet, so the tools read the base elevation below as the ground floor.';
    }
    try { if (typeof PinUI !== 'undefined') PinUI.sync(); } catch (e) { /* the Pin button is optional */ }
  }
  function openCheck(doc) {
    let sec = null, sunSec = null;
    try { sec = ProjectMod.getSection(doc, 'massing'); sunSec = ProjectMod.getSection(doc, 'sun'); } catch (e) { sec = null; }
    const above = (s) => !!s && Number(s.schema) > CONFIG.projectSchema;
    const newerState = !!sec && sec.tool === CONFIG.tool && isObjP(sec.state) && Number(sec.state.schema) > CONFIG.schema;
    const newer = above(sec) || above(sunSec) || newerState || Number(doc.version) > Number(ProjectMod.VERSION || 1);
    return { sec, newer };
  }

  function markDirty() {
    if (!project.doc || project.loading) return;
    project.dirty = true;
    clearTimeout(project.timer);
    project.timer = setTimeout(() => { flush(); }, CONFIG.projectSaveMs);
  }
  function saveFailureText(res) {
    if (!res) return NO_STORAGE_TEXT;
    return String(res.warning || 'The project could not be saved.');
  }
  async function askReplace() {
    if (project.asking) return false;
    project.asking = true;
    const other = toolName(project.replaceTool);
    const ok = await confirmDialog(`This project holds a massing from the ${other}. Saving here replaces it with this tower.`, `Replace the ${other} massing with this tower`);
    project.asking = false;
    if (ok) { project.confirmed = true; project.readOnly = false; renderPill(); flush(); return true; }
    project.readOnly = true;
    renderPill();
    Toast.show(`The project keeps the ${other} massing. Changes here will not be saved to it.`, 'warn', 8000);
    return false;
  }

  /** The "massing" section patch for the design on screen. */
  function sectionPatch() {
    const st = Store.snapshot();
    st.sun.play = false;
    const d = Derived.get();
    const derived = TowerDerivedMod.towerDerived(st, d, d.metrics);
    const pl = { ...placement(), baseMode: baseMode() };
    if (isObjP(Store.raw().placement) && Store.raw().placement.pinned === true) pl.pinned = true;     // Pin placement: saved with the section, a missing value is false
    return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: pl, state: { ...st, placement: pl }, derived, note: st.name };
  }
  /**
   * Writes the massing section (and the sun section when it is wanted) and saves the project. Loads the project fresh from storage
   * first, writes the sections on that copy, saves it. Returns saveProject's result, { ok: true, skipped: true } when there is
   * nothing to do, or { ok: false }.
   */
  function flush() {
    clearTimeout(project.timer);
    project.timer = 0;
    const doc = project.doc;
    if (!doc || project.readOnly || !project.dirty) return { ok: true, skipped: true };
    if (project.replaceNeeded && !project.confirmed) { askReplace(); return { ok: true, skipped: true, asking: true }; }
    const opts = storageNotice();
    let patch;
    try { patch = sectionPatch(); } catch (e) {
      console.error(e);
      Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return { ok: false };
    }
    let base = doc;
    try { base = ProjectMod.loadProject(storageOf(), doc.id, opts) || doc; } catch (e) { base = doc; }
    let next = null;
    try { next = ProjectMod.writeSection(base, 'massing', patch); } catch (e) {
      if (e && e.readOnly) { project.readOnly = true; renderPill(); noticeOnce('readonly', e.message || READ_ONLY_TEXT); return { ok: false, readOnly: true }; }
      console.error(e);
      Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return { ok: false };
    }
    if (sunWanted()) {
      try { next = ProjectMod.writeSection(next, 'sun', sunPatch()); } catch (e) {
        if (e && e.readOnly) { project.readOnly = true; renderPill(); noticeOnce('readonly', e.message || READ_ONLY_TEXT); return { ok: false, readOnly: true }; }
        console.error(e);       // the massing is still saved; the sun section waits for the next change
        noticeOnce('sun-write', `The sun study could not be saved to the project. ${e && e.message ? e.message : ''}`.trim(), 'warn', 8000);
      }
    }
    if (project.renamed) next.name = project.renamed;
    project.doc = next;
    let res = null;
    try { res = ProjectMod.saveProject(storageOf(), next, opts); } catch (e) { console.error(e); }
    if (!res || res.ok === false) {
      noticeOnce(`save:${(res && res.warning) || ''}`, saveFailureText(res), 'bad', 12000);
      return res || { ok: false };
    }
    project.dirty = false;
    project.renamed = null;
    if (res.warning) noticeOnce('warning', String(res.warning));
    renderPill();
    return res;
  }

  /* ---- opening, creating, closing -------------------------------------------------------------- */
  /** Gets the screen ready for a new state: no selection, no compare, no half-done handle drag. */
  function readyScreen() {
    try { if (Render.comparing()) Compare.exit(); } catch (e) { /* the compare view is optional here */ }
    try { Select.cancelHandleDrag(); Select.clear(); } catch (e) { /* nothing selected */ }
  }
  /** Makes `doc` the open project and loads its massing (or sets the placement for a design that has none). */
  function openDoc(doc, { startup = false } = {}) {
    if (project.doc && project.doc !== doc) flush();
    clearTimeout(project.timer);
    const { sec, newer } = openCheck(doc);
    Object.assign(project, { doc, timer: 0, dirty: false, readOnly: !!newer, replaceNeeded: false, replaceTool: null, confirmed: false, renamed: null });
    clearBoundary();
    project.sunHours = null;
    { const s = sectionOf('sun'); if (s && s.tool === CONFIG.tool && isObjP(s.derived) && s.derived.sunHours) project.sunHours = deepClone(s.derived.sunHours); }
    if (newer) noticeOnce('readonly', READ_ONLY_TEXT);
    readyScreen();
    project.loading = true;
    try {
      const hasState = !!sec && isObjP(sec.state) && Object.keys(sec.state).length > 0;
      const mine = !!sec && sec.tool === CONFIG.tool && hasState;
      const foreign = !!sec && !!sec.tool && sec.tool !== CONFIG.tool && (hasState || (isObjP(sec.derived) && Object.keys(sec.derived).length > 0));
      if (mine) {
        let st = deepClone(sec.state);
        if (!(st.schema >= 2)) st = migrateTower(st, Number(st.schema) || 1);
        Store.replace(fillDefaults({ ...st, placement: isObjP(sec.placement) ? sec.placement : ZERO() }), { resetHistory: startup });
      } else {
        if (foreign) { project.replaceNeeded = true; project.replaceTool = sec.tool; }
        const cur = deepClone(Store.raw());
        cur.placement = ZERO();
        if (hasSite()) {
          const info = siteInfo();
          if (foreign && isObjP(sec.placement)) cur.placement = { x: num(sec.placement.x, 0), y: num(sec.placement.y, 0), rotation: num(sec.placement.rotation, 0), baseZ: num(sec.placement.baseZ, 0) };
          else {
            // a project with a site and no tower yet: the tower starts at the site center, on the ground there
            const z = groundAt(info.center[0], info.center[1]);
            cur.placement = { x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: 0, baseZ: z == null ? 0 : Math.round(z * 10) / 10 };
          }
        } else if (cur.context && cur.context.fromSite) cur.context.fromSite = false;
        Store.replace(fillDefaults(cur), { resetHistory: startup });
      }
    } finally { project.loading = false; }
    if (!(sec && sec.tool === CONFIG.tool && isObjP(sec.state) && Object.keys(sec.state).length)) {
      if (hasSite() && !project.readOnly) {
        project.loading = true;
        try { contextFromSite(undefined, { quiet: true, keepManual: false }); } finally { project.loading = false; }
      }
      if (!project.readOnly) markDirty();              // the new massing section is written (another tool's massing waits for the question)
    }
    if (!project.readOnly) followGround({ merge: true });     // the base elevation is the lowest ground under the footprint (Follow ground)
    if (hasSite()) {                // Glass on open (batch fixes plan 2.1): this session only; the saved option keeps its style, Pin sets Solid
      const was = project.loading;
      project.loading = true;
      try { Store.set('view.siteStyle', isObjP(Store.raw().placement) && Store.raw().placement.pinned === true ? 'solid' : 'glass', { live: false, merge: true }); } finally { project.loading = was; }
    }
    renderPill();
    if (Render.ready()) Render.setView(Render.info().preset || 'axon', true);
    return doc;
  }
  /** Forgets the open project (the saved copy stays where it is). */
  function close() {
    flush();
    clearTimeout(project.timer);
    Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, replaceNeeded: false, replaceTool: null, confirmed: false, renamed: null, sunHours: null });
    clearBoundary();
    project.loading = true;
    try {
      const cur = deepClone(Store.raw());
      cur.placement = null;
      if (cur.context) cur.context.fromSite = false;
      Store.replace(cur);
    } finally { project.loading = false; }
    project.updateUrl(null);
    renderPill();
  }
  const defaultName = () => (String(Store.get('name') || '').trim() || 'New project').slice(0, 80);
  /** New project (a local frame, no site) holding the design on screen. Returns the doc or null. */
  function create(name, { quiet = false } = {}) {
    flush();
    const title = String(name || '').trim().slice(0, 80) || defaultName();
    let doc;
    try { doc = ProjectMod.newProject({ name: title }); } catch (e) {
      console.error(e);
      Toast.show(`The project could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return null;
    }
    Object.assign(project, { doc, timer: 0, dirty: true, readOnly: false, replaceNeeded: false, replaceTool: null, confirmed: false, renamed: null, sunHours: null });
    clearBoundary();
    project.loading = true;
    try {
      // the Site tab's Project section shows as soon as the project is open, so a Store change must follow even when nothing else differs
      if (!Store.set('placement', { ...ZERO(), baseMode: 'follow' }, { live: false })) Store.replace(deepClone(Store.raw()));
    } finally { project.loading = false; }
    const saved = flush();
    project.updateUrl(doc.id);
    renderPill();
    if (!quiet && saved && saved.ok !== false) Toast.show(`Project ${project.doc.name} created.`);
    return project.doc;
  }
  function rename(name) {
    const next = String(name || '').trim().slice(0, 80);
    if (!project.doc || !next || next === project.doc.name) return false;
    project.doc = { ...project.doc, name: next };
    project.renamed = next;
    project.dirty = true;
    renderPill();
    markDirty();
    return true;
  }

  /** Send: the project holds this massing (a project is made now when none is open), then the next tool opens with ?project=<id>. */
  async function send(toolId) {
    Pop.close();
    if (!SEND_TOOLS.includes(toolId)) return false;
    if (!project.doc && !create(defaultName(), { quiet: true })) return false;
    if (project.readOnly && !(project.replaceNeeded && !project.confirmed)) { noticeOnce('readonly', READ_ONLY_TEXT); return false; }
    if (project.replaceNeeded && !project.confirmed) { const ok = await askReplace(); if (!ok) return false; }
    project.dirty = true;
    const saved = flush();
    if (saved && saved.ok === false) return false;
    let url = null;
    try { url = ProjectMod.sendTo(storageOf(), project.doc, toolId, CONFIG.tool, storageNotice()); } catch (e) {
      console.error(e);
      Toast.show(`The project could not be sent. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return false;
    }
    if (!url) { Toast.show('The project could not be sent.', 'bad', 8000); return false; }
    try { project.doc = ProjectMod.loadProject(storageOf(), project.doc.id, storageNotice()) || project.doc; } catch (e) { /* keep the copy in memory */ }
    project.dirty = false;
    project.navigate(url);
    return url;
  }
  function openById(id) { flush(); project.navigate(`${location.pathname}?${typeof UI !== 'undefined' && UI.studyMode ? 'study=sun&' : ''}project=${encodeURIComponent(id)}`); }
  async function exportFile() {
    const doc = project.doc;
    if (!doc) return false;
    project.dirty = true;
    flush();
    try {
      const { filename, blob } = ProjectMod.exportProject(project.doc);
      const res = await ShotMod.deliverImage(blob, filename);
      if (res === 'downloaded') Toast.show(`Saved ${filename}`);
      return filename;
    } catch (e) { console.error(e); Toast.show(`The project file could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', 6000); return false; }
  }
  async function importFile(file) {
    flush();
    try {
      const res = await ProjectMod.importProject(file, storageOf(), storageNotice());
      const doc = res && res.doc;
      if (!doc) throw new Error('The file could not be read.');
      openDoc(doc);
      project.updateUrl(doc.id);
      Toast.show(res.renamed ? `Imported as ${doc.name}.` : `Imported ${doc.name}.`);
      if (res.warning) noticeOnce('warning', String(res.warning));
      return doc;
    } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The file could not be imported.', 'bad', 8000); return null; }
  }

  /* ---- Project menu -------------------------------------------------------------------------------- */
  const whenText = (t) => { try { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  const bytesText = (b) => (Number.isFinite(b) && b > 0 ? (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : '');
  /** The hidden file input for Import (the page body has none, so it is made on first use). */
  function fileInput() {
    let el = $('projFile');
    if (el) return el;
    el = h('input', { type: 'file', id: 'projFile', accept: '.json,application/json', hidden: true });
    el.addEventListener('change', async () => {
      const f = el.files && el.files[0];
      el.value = '';
      if (f) await importFile(f);
    });
    document.body.append(el);
    return el;
  }
  function openMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'projectMenu' });
    const item = (key, title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', 'data-proj': key, 'data-project-id': o.id, disabled: o.disabled, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null));
    const nameField = h('input', { class: 'pop-name', id: 'projName', type: 'text', maxlength: '80', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done', 'aria-label': 'Project name', placeholder: 'Project name', value: defaultName() });
    const doCreate = () => { Pop.close(); create(nameField.value); };
    nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doCreate(); } });
    const newRow = item('new', 'New project', 'Save this design in a new project (no site)', () => { newRow.hidden = true; form.hidden = false; nameField.focus(); nameField.select(); }, { keep: true });
    const form = h('div', { class: 'proj-new', id: 'projNewForm', hidden: true }, nameField,
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn outline', type: 'button', id: 'projCancel', onclick: () => { form.hidden = true; newRow.hidden = false; } }, 'Cancel'),
        h('button', { class: 'btn solid', type: 'button', id: 'projCreate', onclick: doCreate }, 'Create')));
    el.append(newRow, form);
    if (project.replaceNeeded && !project.confirmed) {
      const other = toolName(project.replaceTool);
      el.append(item('replace', `Replace the ${other} massing with this tower`, `The project keeps the ${other} massing until you do`, () => { project.confirmed = true; project.readOnly = false; project.dirty = true; renderPill(); flush(); }));
    }
    el.append(h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Open'));
    let list = [];
    try { list = ProjectMod.listProjects(storageOf(), storageNotice()) || []; } catch (e) { console.error(e); noticeOnce('storage', NO_STORAGE_TEXT); }
    if (!list.length) el.append(h('div', { class: 'pop-note' }, 'No saved projects yet.'));
    for (const p of list.slice(0, CONFIG.projectListMax)) {
      const here = !!project.doc && p.id === project.doc.id;
      el.append(item('open', p.name, [here ? 'Open now' : whenText(p.updatedAt), bytesText(p.bytes)].filter(Boolean).join(' · '), () => openById(p.id), { id: p.id, disabled: here }));
    }
    if (list.length > CONFIG.projectListMax) el.append(item('all', 'All projects', `${list.length - CONFIG.projectListMax} more on the Workspace page`, () => { flush(); project.navigate('../'); }));
    el.append(h('div', { class: 'pop-sep' }),
      item('import', 'Import', 'Add a project file (.cmrlm.json)', () => fileInput().click()),
      item('export', 'Export', project.doc ? `Download ${project.doc.name} as a file` : 'Open or create a project first', exportFile, { disabled: !project.doc }),
      item('close', 'Close project', project.doc ? 'Keep working without a project' : 'No project is open', close, { disabled: !project.doc }));
    Pop.open(anchor, el);
  }

  /* ---- the Site tab: Project site ---------------------------------------------------------------- */
  /** The project name field. */
  function nameControl() {
    const input = h('input', { class: 'pop-name', id: 'projNameField', type: 'text', maxlength: '80', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Project name' });
    input.addEventListener('change', () => { rename(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const refresh = () => { if (document.activeElement !== input) input.value = project.doc ? project.doc.name : ''; };
    Store.subscribe(refresh);
    refresh();
    return { el: h('div', { class: 'ctl text-row' }, h('label', { class: 'ctl-label', for: 'projNameField' }, 'Project name'), input), refresh };
  }
  /**
   * Called once by UI.buildPanel for the 'project' section (Site tab, first; shown only while has() is true).
   * ctx = { bs, els, lenF, degS, get }. Returns { children, more }.
   */
  function buildSite(ctx) {
    const { bs, lenF, degS } = ctx;
    const siteOk = () => hasSite();
    const keep = Controls.toggle({
      label: 'Keep manual blocks',
      bind: { get: () => project.keepManual, set: (v) => { project.keepManual = !!v; Controls.refreshAll(); }, commit: () => {} },
    });
    return {
      children: [
        h('div', { class: 'proj-line', id: 'projLine' }),
        nameControl().el,
        Controls.label('Placement of the tower in the project'),
        Controls.group([lenF('X (east)', 'placement.x', { hardMin: -1e6, hardMax: 1e6 }).el, lenF('Y (north)', 'placement.y', { hardMin: -1e6, hardMax: 1e6 }).el]),
        degS('Rotation (5 degree steps)', 'placement.rotation', -180, 180, { step: 5, hardMin: -360, hardMax: 360 }).el,
        ...baseControl(lenF),
        h('div', { class: 'help', id: 'ffeNote' }),
        Controls.when(siteOk, [
          h('div', { class: 'add-row' }, Controls.button('Center on site', () => centerOnSite(), 'outline sm'), h('span', { class: 'help', style: 'margin:0' }, 'Puts the tower at the site center and its ground floor at the ground there.')),
          Controls.label('Neighbors from the Site Model'),
          Controls.slider({ label: 'Radius around the tower', bind: bs('context.radius'), min: 100, max: 2000, step: 50, hardMin: 50, hardMax: 5000, format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text' }).el,
          h('div', { class: 'add-row' }, Controls.button('Context from site', () => contextFromSite(), 'outline sm'), h('span', { class: 'help', style: 'margin:0', id: 'ctxSiteNote' })),
          keep.el,
          Controls.toggle({ label: 'Context blocks from the site (sun hours and metrics)', bind: bs('context.show') }).el,
        ]).el,
      ],
    };
  }

  /* ---- start ------------------------------------------------------------------------------------------ */
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    Store.subscribe((s, info) => {
      if (project.doc && !project.loading && info && !info.live) {
        const path = String(info.path || '');
        // a change that moves the footprint (or a whole new state): the base elevation follows the ground in the same undo step
        if ((info.kind === 'replace' || footprintPath(path)) && info.kind !== 'undo' && info.kind !== 'redo') followGround({ merge: true });
        // placement or radius changes keep site neighbors in step
        if (s.context && s.context.fromSite && (path === 'context.radius' || path.startsWith('placement'))) {
          project.loading = true;
          try { contextFromSite(undefined, { quiet: true, merge: true }); } finally { project.loading = false; }
        }
      }
      if (project.doc && !project.loading && (!info || !info.live)) markDirty();
      renderPill();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', () => { flush(); });
  }
  /** On start: with ?project=<id> open that project. Without one, a placement left over from an earlier project is cleared. Returns true when a project was opened. */
  function start() {
    wire();
    let id = null;
    try { id = ProjectMod.projectIdFromUrl(location); } catch (e) { id = null; }
    if (!id) {
      const cur = Store.raw();
      if (cur.placement || (cur.context && cur.context.fromSite)) {
        const next = deepClone(cur);
        next.placement = null;
        if (next.context) next.context.fromSite = false;
        Store.replace(next, { resetHistory: true });
      }
      renderPill();
      return false;
    }
    let doc = null, told = false;
    try { doc = ProjectMod.loadProject(storageOf(), id, { onNotice: (message) => { told = true; noticeOnce(`storage:${message}`, String(message)); } }); } catch (e) { console.error(e); }
    if (!doc) {
      if (!told) Toast.show('That project could not be opened. It may have been deleted, or it was saved in another browser.', 'warn', 9000);
      return false;
    }
    openDoc(doc, { startup: true });
    return true;
  }

  return {
    has, hasSite, siteInfo, sitePlace, groundAt, gradingFfe, boundaryKey, boundaryLocal, placement,
    start, openDoc, close, create, rename, flush, send, openMenu, exportFile, importFile, nameControl, buildSite,
    centerOnSite, contextFromSite, prepareNew, markDirty, askReplace, renderPill,
    baseMode, setBaseMode, groundUnderFootprint, followGround, baseFor, baseControl, siteDerived,
    writeSun, sunHoursStored, sunDerived: () => sunDerived(Store.snapshot()),
    doc: () => project.doc,
    status: () => ({ open: !!project.doc, id: project.doc && project.doc.id, name: project.doc && project.doc.name, dirty: project.dirty, readOnly: project.readOnly, replaceNeeded: project.replaceNeeded, confirmed: project.confirmed }),
    // tests: inject storage, navigation and the address bar
    configure: (o) => { Object.assign(project, o || {}); },
    restoreDefaults: () => { Object.assign(project, { storage: null, navigate: DEFAULT_NAV, updateUrl: DEFAULT_URL }); },
    reset: () => { clearTimeout(project.timer); Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {}, replaceNeeded: false, replaceTool: null, confirmed: false, asking: false, renamed: null, sunHours: null, keepManual: false }); clearBoundary(); renderPill(); },
  };
})();
