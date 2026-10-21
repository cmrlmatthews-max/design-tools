/* ==========================================================================
   PROJECT FILE  (docs/project-file-spec.md, sections 8 and 10; plan section 7)
   `ProjectUI` is the glue between the page and src/shared/project.js (ProjectMod).
   With ?project=<id> the page opens that project, loads its "massing" section when the Mid-Rise Generator wrote it,
   and writes that section back after every change (1 s debounce, and on visibilitychange / pagehide).
   Without a project nothing here runs until the Project menu or a Send item is used.
   ProjectMod.writeSection returns a new project and does not change the one it gets. So a save loads the project
   fresh from storage, writes the section on that copy and saves it (another tool may have saved from a second tab).
   Every storage call is inside try/catch. Tests inject storage, navigation and the address bar with configure().
   ========================================================================== */
const ProjectUI = (() => {
  const $ = (id) => document.getElementById(id);
  const ZERO = () => ({ x: 0, y: 0, rotation: 0, baseZ: 0 });
  const READ_ONLY_TEXT = 'This project was saved by a newer version of this tool. You can view it, but changes will not be saved.';
  const NO_STORAGE_TEXT = 'Saving is unavailable in this browser, so the project is kept only until you close this page.';
  const MAX_CONTEXT = 300;
  const project = {
    doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {},
    replaceNeeded: false, confirmed: false, asking: false, renamed: null,
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

  /** The site of the project: { size, boundary (project frame), center, ground } or null. */
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

  /** The ground elevation (project frame, ft) at a project point: bilinear on the site grid. null without a grid. */
  function groundAt(xp, yp) {
    const info = siteInfo();
    const g = info && info.ground;
    if (!g || !Array.isArray(g.points) || !(g.n >= 2) || !(g.spacing > 0) || g.points.length !== g.n * g.n) return null;
    const x0 = g.points[0][0], y0 = g.points[0][1];
    const fi = clamp((xp - x0) / g.spacing, 0, g.n - 1), fj = clamp((yp - y0) / g.spacing, 0, g.n - 1);
    const i = Math.min(Math.floor(fi), g.n - 2), j = Math.min(Math.floor(fj), g.n - 2);
    const tx = fi - i, ty = fj - j;
    const z = (a, b) => g.points[b * g.n + a][2];
    return z(i, j) * (1 - tx) * (1 - ty) + z(i + 1, j) * tx * (1 - ty) + z(i, j + 1) * (1 - tx) * ty + z(i + 1, j + 1) * tx * ty;
  }

  /** The site boundary in the building's own (local) frame, for the renderer. null without a site. */
  let bCache = { key: null, ring: null };
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
  /** Puts the building at the site center, with its floor at the ground there. One undo step. */
  function centerOnSite({ quiet = false } = {}) {
    const info = siteInfo();
    if (!info) { if (!quiet) Toast.show('This project has no site yet. Send a site from the Site Model first.', 'warn'); return false; }
    const z = groundAt(info.center[0], info.center[1]);
    const next = { x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: placement().rotation, baseZ: z == null ? placement().baseZ : Math.round(z * 10) / 10 };
    Store.set('placement', next, { live: false });
    if (!quiet) Toast.show(z == null ? 'Centered on the site.' : `Centered on the site. Floor at ${Units.formatFeetInches(next.baseZ)} above sea level.`);
    return true;
  }
  /** The site buildings near the building become context blocks (fromSite = true). One undo step. Returns the count, or -1. */
  function contextFromSite(radius, { quiet = false, merge = false } = {}) {
    if (!project.doc) { if (!quiet) Toast.show('Open a project first.', 'warn'); return -1; }
    if (!hasSite()) { if (!quiet) Toast.show('This project has no site, so there are no neighbors to load.', 'warn'); return -1; }
    const r = Number.isFinite(radius) && radius > 0 ? radius : num(Store.get('context.radius'), CONFIG.contextRadius);
    let res;
    try { res = ProjectMod.siteContextFor(project.doc, placement(), r); } catch (e) { console.error(e); Toast.show('The neighbors could not be read from the site.', 'bad'); return -1; }
    let blocks = res.blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d, h: b.h, base: b.base }));
    let trimmed = 0;
    if (blocks.length > MAX_CONTEXT) {
      blocks.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      trimmed = blocks.length - MAX_CONTEXT;
      blocks = blocks.slice(0, MAX_CONTEXT);
    }
    const cur = Store.raw().context;
    Store.set('context', { ...deepClone(cur), blocks, fromSite: true, show: true, radius: r }, { live: false, merge });
    if (!quiet) Toast.show(blocks.length ? `Loaded ${blocks.length} neighbor${blocks.length === 1 ? '' : 's'} within ${Units.formatFeetInches(r)}.${trimmed ? ` ${trimmed} farther ones were left out.` : ''}` : `No site buildings within ${Units.formatFeetInches(r)}.`);
    return blocks.length;
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
      const n = (Store.raw().context.blocks || []).length;
      note.textContent = Store.raw().context.fromSite ? `${n} block${n === 1 ? '' : 's'} from the site.` : '';
    }
  }
  function openCheck(doc) {
    let sec = null;
    try { sec = ProjectMod.getSection(doc, 'massing'); } catch (e) { sec = null; }
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
  async function askReplace() {
    if (project.asking) return false;
    project.asking = true;
    const ok = await confirmDialog('This project holds a massing from the Tower Generator. Saving here replaces it with this mid-rise design.', 'Replace the tower massing with this option');
    project.asking = false;
    if (ok) { project.confirmed = true; project.readOnly = false; renderPill(); flush(); return true; }
    project.readOnly = true;
    renderPill();
    Toast.show('The project keeps the tower massing. Changes here will not be saved to it.', 'warn', 8000);
    return false;
  }

  /** The "massing" section patch for the design on screen. */
  function sectionPatch() {
    const st = Store.snapshot();
    const d = Derived.get();
    const derived = MidDerivedMod.midriseDerived(st, d.built, d.metrics);
    const pl = placement();
    return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: pl, state: { ...st, placement: pl }, derived, note: st.name };
  }
  /**
   * Writes the massing section and saves the project. Loads the project fresh from storage first, writes the section on that copy,
   * saves it. Returns saveProject's result, { ok: true, skipped: true } when there is nothing to do, or { ok: false }.
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
  /** Makes `doc` the open project and loads its massing (or sets the placement for a design that has none). */
  function openDoc(doc, { startup = false } = {}) {
    if (project.doc && project.doc !== doc) flush();
    clearTimeout(project.timer);
    const { sec, newer } = openCheck(doc);
    Object.assign(project, { doc, timer: 0, dirty: false, readOnly: !!newer, replaceNeeded: false, confirmed: false, renamed: null });
    bCache = { key: null, ring: null };
    if (newer) noticeOnce('readonly', READ_ONLY_TEXT);
    project.loading = true;
    try {
      const mine = sec && sec.tool === CONFIG.tool && isObjP(sec.state) && Object.keys(sec.state).length;
      const tower = sec && sec.tool === 'tower' && isObjP(sec.state) && Object.keys(sec.state).length;
      if (mine) {
        const st = fillDefaults({ ...sec.state, placement: isObjP(sec.placement) ? sec.placement : ZERO() });
        Store.replace(st, { resetHistory: startup });
      } else {
        if (tower) project.replaceNeeded = true;
        const cur = deepClone(Store.raw());
        cur.placement = ZERO();
        if (!tower && hasSite()) {
          // a project with a site and no mid-rise yet: the building starts at the site center, with the real neighbors
          const info = siteInfo();
          const z = groundAt(info.center[0], info.center[1]);
          cur.placement = { x: Math.round(info.center[0] * 100) / 100, y: Math.round(info.center[1] * 100) / 100, rotation: 0, baseZ: z == null ? 0 : Math.round(z * 10) / 10 };
        } else if (tower && hasSite()) {
          const info = siteInfo();
          if (isObjP(sec.placement)) cur.placement = { x: num(sec.placement.x, 0), y: num(sec.placement.y, 0), rotation: num(sec.placement.rotation, 0), baseZ: num(sec.placement.baseZ, 0) };
          else cur.placement = { x: info.center[0], y: info.center[1], rotation: 0, baseZ: 0 };
        }
        if (!hasSite() && cur.context && cur.context.fromSite) cur.context.fromSite = false;
        Store.replace(fillDefaults(cur), { resetHistory: startup });
      }
    } finally { project.loading = false; }
    if (!sec || !(sec.tool === CONFIG.tool)) {
      if (hasSite() && !project.replaceNeeded && !project.readOnly) {
        project.loading = true;
        try { contextFromSite(undefined, { quiet: true }); } finally { project.loading = false; }
        markDirty();                                     // the new massing section is written (a tower project waits for the question)
      } else if (!project.replaceNeeded && !project.readOnly) markDirty();
    }
    renderPill();
    if (Render.ready()) Render.setView(Render.info().preset || 'axon', true);
    return doc;
  }
  /** Forgets the open project (the saved copy stays where it is). */
  function close() {
    flush();
    clearTimeout(project.timer);
    Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, replaceNeeded: false, confirmed: false, renamed: null });
    bCache = { key: null, ring: null };
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
    Object.assign(project, { doc, timer: 0, dirty: true, readOnly: false, replaceNeeded: false, confirmed: false, renamed: null });
    bCache = { key: null, ring: null };
    project.loading = true;
    try { Store.set('placement', ZERO(), { live: false }); } finally { project.loading = false; }
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
    if (toolId !== 'plate' && toolId !== 'parking') return false;
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
    const newRow = item('new', 'New project', 'Save this design in a new project (no site)', () => { newRow.hidden = true; form.hidden = false; nameField.focus(); nameField.select(); }, { keep: true });
    const form = h('div', { class: 'proj-new', id: 'projNewForm', hidden: true }, nameField,
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn outline', type: 'button', id: 'projCancel', onclick: () => { form.hidden = true; newRow.hidden = false; } }, 'Cancel'),
        h('button', { class: 'btn solid', type: 'button', id: 'projCreate', onclick: doCreate }, 'Create')));
    el.append(newRow, form);
    if (project.replaceNeeded && !project.confirmed) {
      el.append(item('replace', 'Replace the tower massing with this option', 'The project keeps the tower massing until you do', () => { project.confirmed = true; project.readOnly = false; project.dirty = true; renderPill(); flush(); }));
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
      item('import', 'Import', 'Add a project file (.cmrlm.json)', () => $('projFile').click()),
      item('export', 'Export', project.doc ? `Download ${project.doc.name} as a file` : 'Open or create a project first', exportFile, { disabled: !project.doc }),
      item('close', 'Close project', project.doc ? 'Keep working without a project' : 'No project is open', close, { disabled: !project.doc }));
    Pop.open(anchor, el);
  }

  /** The project name field for the Site tab. */
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
    has, hasSite, siteInfo, groundAt, boundaryKey, boundaryLocal, placement,
    start, openDoc, close, create, rename, flush, send, openMenu, exportFile, importFile, nameControl,
    centerOnSite, contextFromSite, markDirty, askReplace, renderPill,
    doc: () => project.doc,
    status: () => ({ open: !!project.doc, id: project.doc && project.doc.id, name: project.doc && project.doc.name, dirty: project.dirty, readOnly: project.readOnly, replaceNeeded: project.replaceNeeded, confirmed: project.confirmed }),
    // tests: inject storage, navigation and the address bar
    configure: (o) => { Object.assign(project, o || {}); },
    restoreDefaults: () => { Object.assign(project, { storage: null, navigate: DEFAULT_NAV, updateUrl: DEFAULT_URL }); },
    reset: () => { clearTimeout(project.timer); Object.assign(project, { doc: null, timer: 0, dirty: false, readOnly: false, loading: false, noted: {}, replaceNeeded: false, confirmed: false, asking: false, renamed: null }); bCache = { key: null, ring: null }; renderPill(); },
  };
})();
