/* ==========================================================================
   PROJECT FILE  (docs/project-file-spec.md; plan section 7)
   `ProjectUI` is the glue between the page and src/shared/project.js (ProjectMod).
   With ?project=<id> the page opens that project. buildGrading reads the project (it is the only reader): the "site" section (ground,
   boundary, roads, neighbors), the "massing" section (footprint) and the "parking" section (levels). This file hands the document to
   the pipeline through dataDoc() and writes the "grading" section back after every change (1 s debounce, and on visibilitychange /
   pagehide). The grading section always has the identity placement: the plan is in the project frame.
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
  const placement = () => ZERO();

  /* ---- reading the project (plan section 7) ---------------------------------------------------- */
  const hasSection = (key) => !!sectionOf(key);
  const hasMassing = () => hasSection('massing');
  const hasParking = () => hasSection('parking');
  const hasSiteGround = () => { const sec = sectionOf('site'); return !!(sec && sec.derived && sec.derived.ground); };
  const massingLevels = () => {
    const sec = sectionOf('massing');
    const dv = sec && sec.derived;
    return dv && Array.isArray(dv.levels) ? dv.levels : [];
  };
  /** The project document the layout, the overlay and the metrics read (null without a project). */
  const dataDoc = () => project.doc || null;
  /** A key that changes when the site, massing or parking data changes (not when this tool saves its own section). */
  function dataKey() {
    if (!project.doc) return '';
    const m = sectionOf('massing'), p = sectionOf('parking'), si = sectionOf('site');
    return `${project.doc.id}|${(m && m.updatedAt) || ''}|${(p && p.updatedAt) || ''}|${(si && si.updatedAt) || ''}`;
  }
  /** What the open project offers: { has, tool, levels, noLevels, parking, site }. */
  function massingInfo() {
    const sec = sectionOf('massing');
    const list = massingLevels().filter((l) => l && Array.isArray(l.plates) && l.plates.length);
    return { has: !!sec, tool: sec ? (sec.tool || null) : null, levels: list.length, noLevels: !!sec && list.length === 0, parking: hasParking(), site: hasSiteGround() };
  }
  const massingPlacement = () => null;
  /** The site neighbors in the project frame: [{ id, name, outer, holes, base, height }]. */
  function contextPolys() {
    if (!project.doc) return [];
    try { return ProjectMod.siteContextFor(project.doc, ZERO(), CONFIG.contextRadius).polygons || []; } catch (e) { return []; }
  }
  const isDefaultBar = (b) => b.source === 'typed' && JSON.stringify(b.outer) === JSON.stringify(defaultState().buildings[0].outer) && (b.tiers || []).length === 1;
  const projectBuilding = (source, n) => ({ id: `${source === 'massing' ? 'M' : 'P'}${n}`, name: source === 'massing' ? 'Massing' : 'Parking deck', source, axis: 'auto', tiers: [{ length: null, ffe: 'balance' }], padOffset: 5, padDepth: 1 });
  /**
   * Takes the open project as the source (plan section 7): the site ground becomes the existing ground, and the massing and the parking
   * deck become buildings when the state has none of that source. An untouched default bar makes room for them. One undo step.
   * Returns true when the project offers any of the three.
   */
  function useProject({ quiet = false } = {}) {
    if (!project.doc || !(hasSiteGround() || hasMassing() || hasParking())) { if (!quiet) Toast.show('Open a project that has a site, a massing or a parking deck first (Project menu).', 'warn', 6000); return false; }
    const next = deepClone(Store.raw());
    next.source = 'project';
    if (hasSiteGround()) next.ground.mode = 'site';
    const add = [];
    if (hasMassing() && !next.buildings.some((b) => b.source === 'massing')) add.push(projectBuilding('massing', 1));
    if (hasParking() && !next.buildings.some((b) => b.source === 'parking')) add.push(projectBuilding('parking', 1));
    if (add.length) {
      if (next.buildings.length === 1 && isDefaultBar(next.buildings[0])) next.buildings = [];
      next.buildings.push(...add);
    }
    Store.replace(fillDefaults(next));
    if (!quiet) {
      const info = massingInfo();
      Toast.show(info.noLevels ? 'The project massing has no levels yet.' : `Project: ${[hasSiteGround() ? 'site ground' : null, hasMassing() ? 'massing' : null, hasParking() ? 'parking deck' : null].filter(Boolean).join(', ')}.`);
    }
    return true;
  }
  /** Back to the free-standing design: the project buildings go, and the typed plane is the ground. */
  function useStandalone() {
    const cur = Store.raw();
    if (cur.source === 'standalone') return false;
    const next = deepClone(cur);
    next.source = 'standalone';
    next.ground.mode = 'plane';
    next.buildings = next.buildings.filter((b) => b.source === 'typed');
    if (!next.buildings.length) next.buildings = defaultState().buildings;
    Store.replace(fillDefaults(next));
    return true;
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
      const bits = [hasSiteGround() ? 'site ground' : null, hasMassing() ? 'massing' : null, hasParking() ? 'parking deck' : null].filter(Boolean);
      line.textContent = `Project “${doc.name}”${project.readOnly ? ' (read only)' : ''}. ${bits.length ? `It has: ${bits.join(', ')}.` : 'It has no site, massing or parking deck yet.'}`;
    }
  }
  function openCheck(doc) {
    let sec = null;
    try { sec = ProjectMod.getSection(doc, 'grading'); } catch (e) { sec = null; }
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
  /** The "grading" section patch for the design on screen. */
  function sectionPatch() {
    const st = Store.snapshot();
    const d = Derived.get();
    const derived = GradDerivedMod.gradingDerived(st, d.built, d.metrics);
    return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: ZERO(), state: st, derived, note: st.name };
  }
  /**
   * Writes the grading section and saves the project. Loads the project fresh from storage first, writes the section on that copy,
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
    try { next = ProjectMod.writeSection(base, 'grading', patch); } catch (e) {
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
  /** Makes `doc` the open project. A grading section of this tool is loaded; otherwise the design on screen starts on the project (site ground, massing, parking). */
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
      if (mine) Store.replace(fillDefaults({ ...sec.state }), { resetHistory: startup });
      else { Store.replace(fillDefaults(deepClone(Store.raw())), { resetHistory: startup }); started = true; }
    } finally { project.loading = false; }
    if (started) {
      project.loading = true;
      try { useProject({ quiet: true }); } finally { project.loading = false; }
      if (!project.readOnly) markDirty();
    }
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
      useStandalone();
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
    project.loading = false;
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
    project.doc = fresh;
    if (dataKey() !== before) { renderPill(); Render.requestRender(); return true; }
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

  /** The project name field for the Source section. */
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
      if (Store.raw().source !== 'standalone') {
        const next = deepClone(Store.raw());
        next.source = 'standalone';
        if (next.ground.mode === 'site') next.ground.mode = 'plane';
        Store.replace(fillDefaults(next), { resetHistory: true });
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
    has, hasMassing, hasParking, hasSiteGround, hasSection, massingInfo, placement, useProject, useStandalone, contextPolys, dataDoc, dataKey, massingPlacement,
    start, openDoc, close, create, rename, flush, openMenu, exportFile, importFile, nameControl, reloadData,
    markDirty, renderPill,
    doc: () => project.doc,
    status: () => ({ open: !!project.doc, id: project.doc && project.doc.id, name: project.doc && project.doc.name, dirty: project.dirty, readOnly: project.readOnly }),
    // tests: inject storage, navigation and the address bar
    configure: (o) => { Object.assign(project, o || {}); },
    restoreDefaults: () => { Object.assign(project, { storage: null, navigate: DEFAULT_NAV, updateUrl: DEFAULT_URL }); },
    reset: () => { clearTimeout(project.timer); Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {}, renamed: null }); renderPill(); },
  };
})();
