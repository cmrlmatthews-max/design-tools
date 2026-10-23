/* ==========================================================================
   PROJECT FILE  (docs/project-file-spec.md; plan section 7)
   `ProjectUI` is the glue between the page and src/shared/project.js (ProjectMod).
   With ?project=<id> the page opens that project. It reads the "massing" section (deck and podium levels, plates, core seeds,
   placement, units) and the "plates" section (demising lines) through dataDoc(), and writes the "parking" section back after
   every change (1 s debounce, and on visibilitychange / pagehide).
   Without a project nothing here runs until the Project menu is used; the tool works standalone.
   ProjectMod.writeSection returns a new project and does not change the one it gets. So a save loads the project
   fresh from storage, writes the section on that copy and saves it (another tool may have saved from a second tab).
   Every storage call is inside try/catch. Tests inject storage, navigation and the address bar with configure().
   ========================================================================== */
const ProjectUI = (() => {
  const $ = (id) => document.getElementById(id);
  const ZERO = () => ({ x: 0, y: 0, rotation: 0, baseZ: 0 });
  const READ_ONLY_TEXT = 'This project was saved by a newer version of this tool. You can view it, but changes will not be saved.';
  const NO_STORAGE_TEXT = 'Saving is unavailable in this browser, so the project is kept only until you close this page.';
  const project = {
    doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {},
    renamed: null,
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

  /* ---- reading the massing (plan section 7) ---------------------------------------------------- */
  const massing = () => sectionOf('massing');
  const massingLevels = () => {
    const sec = massing();
    const dv = sec && sec.derived;
    return dv && Array.isArray(dv.levels) ? dv.levels : [];
  };
  /** The project document the layout, the overlay and the metrics read (null without a project). */
  const dataDoc = () => project.doc || null;
  /** A key that changes when the massing or plates data changes (not when this tool saves its own section). */
  function dataKey() {
    if (!project.doc) return '';
    const m = sectionOf('massing'), p = sectionOf('plates');
    return `${project.doc.id}|${(m && m.updatedAt) || ''}|${(p && p.updatedAt) || ''}`;
  }
  /** Deck and podium levels of the massing, lowest first: { zone, levels: [{ index, z, ftf, area }] } for each zone that has some. */
  function sources() {
    const out = [];
    for (const [source, zone] of [['wrap', 'deck'], ['podium', 'podium']]) {
      const list = massingLevels().filter((l) => l && l.zone === zone && Array.isArray(l.plates) && l.plates.length)
        .slice().sort((a, b) => num(a.z, 0) - num(b.z, 0));
      if (list.length) out.push({ source, zone, levels: list.map((l) => ({ index: l.index, z: num(l.z, 0), ftf: num(l.ftf, 10.5), area: Math.round(multiArea(l.plates)) })) });
    }
    return out;
  }
  const hasMassing = () => !!massing();
  const massingPlacement = () => {
    const sec = massing();
    const p = sec && sec.placement;
    return isObjP(p) ? { x: num(p.x, 0), y: num(p.y, 0), rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : null;
  };
  /** The units the massing reports (null when none). */
  const massingUnits = () => {
    const sec = massing();
    const m = sec && sec.derived && sec.derived.metrics;
    return m && isFinite(m.units) ? m.units : null;
  };
  /** The massing levels shown as a ghost above the deck: { polys, z, ftf }. In the massing (local) frame. */
  function ghostLevels(state) {
    if (!project.doc) return [];
    const skip = state.source === 'wrap' ? 'deck' : state.source === 'podium' ? 'podium' : null;
    const out = [];
    for (const l of massingLevels()) {
      if (!l || !Array.isArray(l.plates) || !l.plates.length) continue;
      if (l.zone === skip) continue;
      if (state.source === 'standalone' && l.zone !== 'bar') continue;
      out.push({ polys: l.plates, z: num(l.z, 0), ftf: num(l.ftf, 10.5) });
    }
    return out;
  }
  /** Takes the deck or the podium of the massing as the footprint and the level stack. One undo step. Returns true when it worked. */
  function useSource(source, { quiet = false } = {}) {
    const src = sources().find((x) => x.source === source);
    if (!src) { if (!quiet) Toast.show(source === 'wrap' ? 'The project has no deck levels. Send a design with a deck from the Mid-Rise Generator.' : 'The project has no podium levels. Send a design with a podium from the Mid-Rise Generator.', 'warn', 6000); return false; }
    const next = deepClone(Store.raw());
    const lv = src.levels;
    next.source = source;
    next.sourceLevel = lv[0].index;
    next.levels.count = Math.min(CONFIG.limits.maxLevels, lv.length);
    next.levels.ftf1 = lv[0].ftf;
    next.levels.ftf = lv[1] ? lv[1].ftf : lv[0].ftf;
    next.levels.belowGrade = lv.filter((l) => l.z < -0.01).length;
    next.coresFromProject = true;
    const pl = massingPlacement();
    if (pl) next.placement = pl;
    Store.replace(fillDefaults(next));
    if (!quiet) Toast.show(`${SOURCE_LABELS[source]}: ${lv.length} level${lv.length === 1 ? '' : 's'} from the project.`);
    return true;
  }
  /** Back to a free-standing deck (the footprint and levels in the state stay as they are). */
  function useStandalone() {
    if (Store.raw().source === 'standalone') return false;
    Store.set('source', 'standalone', { live: false });
    return true;
  }

  /* ---- base elevation: Follow ground or Typed (docs/site-base-style-technical-plan.md section 1) ------------------------------- */
  // A committed change under one of these paths moves the footprint, so followGround runs again.
  const FOOTPRINT_KEYS = ['placement', 'source', 'sourceLevel', 'footprint', 'levels', 'bays', 'grid', 'ramp', 'cores', 'entries', 'liner'];
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
  /** True when the base elevation follows the ground now: a project is open, the mode is Follow and the deck is standalone. */
  const followsGround = () => !!project.doc && isObjP(Store.raw().placement) && baseMode() === 'follow' && Store.raw().source === 'standalone';
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
      const n = sources().map((s) => `${s.levels.length} ${s.zone} level${s.levels.length === 1 ? '' : 's'}`).join(', ');
      line.textContent = `Project “${doc.name}”${project.readOnly ? ' (read only)' : ''}. ${hasMassing() ? `Massing: ${n || 'no deck or podium levels'}.` : 'No massing in this project yet.'}`;
    }
  }
  function openCheck(doc) {
    let sec = null;
    try { sec = ProjectMod.getSection(doc, 'parking'); } catch (e) { sec = null; }
    const newer = (sec && Number(sec.schema) > CONFIG.projectSchema) || Number(doc.version) > Number(ProjectMod.VERSION || 1);
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
  /** The "parking" section patch for the design on screen. */
  function sectionPatch() {
    const st = Store.snapshot();
    const d = Derived.get();
    const derived = ParkDerivedMod.parkingDerived(st, d.built, d.metrics);
    const pl = { ...placement(), baseMode: baseMode() };
    return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: pl, state: { ...st, placement: pl }, derived, note: st.name };
  }
  /**
   * Writes the parking section and saves the project. Loads the project fresh from storage first, writes the section on that copy,
   * saves it. Returns saveProject's result, { ok: true, skipped: true } when there is nothing to do, or { ok: false }.
   */
  function flush() {
    clearTimeout(project.timer);
    project.timer = 0;
    const doc = project.doc;
    if (!doc || project.readOnly || !project.dirty) return { ok: true, skipped: true };
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
    try { next = ProjectMod.writeSection(base, 'parking', patch); } catch (e) {
      if (e && e.readOnly) { project.readOnly = true; renderPill(); noticeOnce('readonly', e.message || READ_ONLY_TEXT); return { ok: false, readOnly: true }; }
      console.error(e);
      Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return { ok: false };
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
  /** Makes `doc` the open project. A parking section of this tool is loaded; otherwise the massing decides the start. */
  function openDoc(doc, { startup = false } = {}) {
    if (project.doc && project.doc !== doc) flush();
    clearTimeout(project.timer);
    const { sec, newer } = openCheck(doc);
    Object.assign(project, { doc, timer: 0, dirty: false, readOnly: !!newer, renamed: null });
    if (newer) noticeOnce('readonly', READ_ONLY_TEXT);
    project.loading = true;
    let started = false;
    try {
      const mine = sec && sec.tool === CONFIG.tool && isObjP(sec.state) && Object.keys(sec.state).length;
      if (mine) {
        const st = fillDefaults({ ...sec.state, placement: isObjP(sec.placement) ? sec.placement : (massingPlacement() || ZERO()) });
        Store.replace(st, { resetHistory: startup });
      } else {
        const cur = deepClone(Store.raw());
        cur.placement = massingPlacement() || ZERO();
        Store.replace(fillDefaults(cur), { resetHistory: startup });
        started = true;
      }
    } finally { project.loading = false; }
    if (started) {
      // a project with a deck (or a podium) starts with it; otherwise the free-standing deck stays
      const found = sources();
      project.loading = true;
      try { if (found.length) useSource(found[0].source, { quiet: true }); } finally { project.loading = false; }
      if (!project.readOnly) markDirty();
    }
    if (!project.readOnly) followGround({ merge: true });     // a standalone deck: the base elevation is the lowest ground under the footprint
    renderPill();
    if (Render.ready()) Render.setView(Render.info().preset || 'axon', true);
    return doc;
  }
  /** Forgets the open project (the saved copy stays where it is). */
  function close() {
    flush();
    clearTimeout(project.timer);
    Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, renamed: null });
    project.loading = true;
    try {
      const cur = deepClone(Store.raw());
      cur.placement = null;
      if (cur.source !== 'standalone') { cur.source = 'standalone'; cur.sourceLevel = null; }
      Store.replace(cur);
    } finally { project.loading = false; }
    project.updateUrl(null);
    renderPill();
  }
  const defaultName = () => (String(Store.get('name') || '').trim() || 'New project').slice(0, 80);
  /** New project (a local frame) holding the design on screen. Returns the doc or null. */
  function create(name, { quiet = false } = {}) {
    flush();
    const title = String(name || '').trim().slice(0, 80) || defaultName();
    let doc;
    try { doc = ProjectMod.newProject({ name: title }); } catch (e) {
      console.error(e);
      Toast.show(`The project could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return null;
    }
    Object.assign(project, { doc, timer: 0, dirty: true, readOnly: false, renamed: null });
    project.loading = true;
    try { Store.set('placement', { ...ZERO(), baseMode: 'follow' }, { live: false }); } finally { project.loading = false; }
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

  /** Send to Facade Studio: save the project, then open ../facade/?project=<id>. With no project open, one is made first. */
  async function send(toolId) {
    Pop.close();
    if (toolId !== 'facade' && toolId !== 'grading') return false;
    if (!project.doc && !create(defaultName(), { quiet: true })) return false;
    if (project.readOnly) { noticeOnce('readonly', READ_ONLY_TEXT); return false; }
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
  function openById(id) { flush(); project.navigate(`${location.pathname}?project=${encodeURIComponent(id)}`); }
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
  /** When the page comes back to the front, another tool may have changed the massing: take the fresh project data. */
  function reloadData() {
    if (!project.doc || project.dirty) return false;
    let fresh = null;
    try { fresh = ProjectMod.loadProject(storageOf(), project.doc.id, storageNotice()); } catch (e) { fresh = null; }
    if (!fresh) return false;
    const before = dataKey();
    const siteBefore = (sectionOf('site') || {}).updatedAt || '';
    project.doc = fresh;
    const siteChanged = ((sectionOf('site') || {}).updatedAt || '') !== siteBefore;
    if (siteChanged) followGround({ merge: true });          // a new site arrived: the base follows its ground
    if (dataKey() !== before || siteChanged) { renderPill(); Render.requestRender(); return true; }
    return false;
  }

  /* ---- Project menu -------------------------------------------------------------------------------- */
  const whenText = (t) => { try { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  const bytesText = (b) => (Number.isFinite(b) && b > 0 ? (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : '');
  function openMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'projectMenu' });
    const item = (key, title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', 'data-proj': key, 'data-project-id': o.id, disabled: o.disabled, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null));
    const nameField = h('input', { class: 'pop-name', id: 'projName', type: 'text', maxlength: '80', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done', 'aria-label': 'Project name', placeholder: 'Project name', value: defaultName() });
    const doCreate = () => { Pop.close(); create(nameField.value); };
    nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doCreate(); } });
    const newRow = item('new', 'New project', 'Save this design in a new project', () => { newRow.hidden = true; form.hidden = false; nameField.focus(); nameField.select(); }, { keep: true });
    const form = h('div', { class: 'proj-new', id: 'projNewForm', hidden: true }, nameField,
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn outline', type: 'button', id: 'projCancel', onclick: () => { form.hidden = true; newRow.hidden = false; } }, 'Cancel'),
        h('button', { class: 'btn solid', type: 'button', id: 'projCreate', onclick: doCreate }, 'Create')));
    el.append(newRow, form);
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
      item('import', 'Import', 'Add a project file (.cmrlm.json)', () => $('projFile').click()),
      item('export', 'Export', project.doc ? `Download ${project.doc.name} as a file` : 'Open or create a project first', exportFile, { disabled: !project.doc }),
      item('close', 'Close project', project.doc ? 'Keep working without a project' : 'No project is open', close, { disabled: !project.doc }));
    Pop.open(anchor, el);
  }

  /** The project name field for the Layout tab. */
  function nameControl() {
    const input = h('input', { class: 'pop-name', id: 'projNameField', type: 'text', maxlength: '80', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Project name' });
    input.addEventListener('change', () => { rename(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const refresh = () => { if (document.activeElement !== input) input.value = project.doc ? project.doc.name : ''; };
    Store.subscribe(refresh);
    return { el: h('div', { class: 'ctl text-row' }, h('label', { class: 'ctl-label', for: 'projNameField' }, 'Project name'), input), refresh };
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
      }
      if (project.doc && !project.loading && (!info || !info.live)) markDirty();
      renderPill();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else reloadData(); });
    window.addEventListener('pagehide', () => { flush(); });
    const file = $('projFile');
    if (file) file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (f) await importFile(f);
    });
  }
  /** On start: with ?project=<id> open that project. Without one, a placement left over from an earlier project is cleared. Returns true when a project was opened. */
  function start() {
    wire();
    let id = null;
    try { id = ProjectMod.projectIdFromUrl(location); } catch (e) { id = null; }
    if (!id) {
      const cur = Store.raw();
      if (cur.placement || cur.source !== 'standalone') {
        const next = deepClone(cur);
        next.placement = null;
        if (next.source !== 'standalone') { next.source = 'standalone'; next.sourceLevel = null; }
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
    has, hasMassing, placement, sources, useSource, useStandalone, ghostLevels, dataDoc, dataKey, massingUnits, massingPlacement,
    start, openDoc, close, create, rename, flush, send, openMenu, exportFile, importFile, nameControl, reloadData,
    markDirty, renderPill,
    baseMode, setBaseMode, groundUnderFootprint, followGround, baseFor, baseControl, siteDerived,
    doc: () => project.doc,
    status: () => ({ open: !!project.doc, id: project.doc && project.doc.id, name: project.doc && project.doc.name, dirty: project.dirty, readOnly: project.readOnly }),
    // tests: inject storage, navigation and the address bar
    configure: (o) => { Object.assign(project, o || {}); },
    restoreDefaults: () => { Object.assign(project, { storage: null, navigate: DEFAULT_NAV, updateUrl: DEFAULT_URL }); },
    reset: () => { clearTimeout(project.timer); Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {}, renamed: null }); renderPill(); },
  };
})();
