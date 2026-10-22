/* ==========================================================================
   UI
   Top bar, control panel, progress list, metrics, downloads, screenshot,
   recent sites and the bottom sheet (iPad portrait and phone).
   ========================================================================== */
const App = (() => {
  const { googleMapsUrl, parseCoordinates } = GeocodeMod;
  const { summarize } = ModelMod;
  const { revitCsv, siteDxf, notesMarkdown, CREDITS } = ExportsMod;
  const { siteToSketchup } = SkSite;
  const { sketchupFilename, docToBlob } = SkFmt;
  const { siteDerived, siteState, derivedBytes } = SiteDerivedMod;

  const HELP_REMOVE = 'Click a building in the 3D view to open its card. Select Remove on the card to take the building out of the site. A dashed outline stays on the ground where the building stood. Select Restore on the card to put the building back. Select Restore all in the panel to put back every removed building. The list of removed buildings stays when you load the same address again. Every other tool and every export leaves out a removed building. The DXF file draws its ground outline on the layer BLDG-REMOVED. A removed building casts no shadow.';

  const state = {
    size: CONFIG.defaultSize,
    layers: { ground: true, buildings: true, roads: true, walks: false, trees: true, water: true },
    vscale: 1, contour: 0,
    busy: false, runId: 0, t0: 0, timer: 0,
    result: null, typed: '', elapsed: null,
    removed: new Set(),         // ids of the buildings the user removed (base ids, no ~n suffix); saved as meta.removed in the project
    removedKey: null,           // the site (lat, lon, size) the list belongs to; null = it adopts the next site that loads
    selected: null,             // { id, building } of the building in the selection card, or null
  };
  const baseId = (id) => String(id).replace(/~\d+$/, '');
  const removedList = () => [...state.removed].sort();
  const siteKeyOf = (r) => `${Number(r.loc.lat).toFixed(5)},${Number(r.loc.lon).toFixed(5)},${r.frame.size}`;
  const els = {};
  /* The open project (docs/project-file-spec.md). The injectable parts (storage, navigate, updateUrl) are for the in-page tests. */
  const project = {
    doc: null,                  // the open project, a document in memory, or null
    storage: null,              // a Storage-like object; null = the localStorage of the browser
    readOnly: false,            // the site section is newer than this page: never write
    pending: null,              // the site section waiting to be written: { section, frame } (see flushProject)
    dirty: false, timer: 0,     // the document in memory has a change that is not saved yet; the autosave timer
    written: null,              // { result, walks } of the last queued write (Send does not queue the same site twice)
    noted: {},                  // notices that were shown already, by key (each one is shown once)
    navigate: (url) => { location.href = url; },
    updateUrl: (id) => { try { history.replaceState(null, '', projectHref(id)); } catch (e) { /* ignore */ } },
  };
  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const sheetQuery = window.matchMedia('(max-width: 899px), (orientation: portrait)');

  /* ---- naming ------------------------------------------------------------------ */
  function slugOf(r = state.result) {
    const base = (state.typed || (r && r.loc.label) || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'site';
    return `${base}-${r ? r.frame.size : state.size}ft`;
  }
  const todayIso = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function metaOf(r = state.result) {
    return { address: state.typed || r.loc.label, lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, release: r.release, date: todayIso(), removed: removedList() };
  }
  /** metaOf plus the walks flag: the model has a walk layer. Used for the project file. */
  function projectMeta(r = state.result) { return { ...metaOf(r), walks: !!(r.model.roads && r.model.roads.walks) }; }

  /* ---- progress list ----------------------------------------------------------------- */
  function setStep(step, status, msg) {
    const li = els.steps && els.steps.querySelector(`[data-step="${step}"]`);
    if (!li) return;
    li.dataset.s = status;
    li.querySelector('.ms').textContent = msg || (status === 'pending' ? 'Waiting' : '');
  }
  function setProgressOpen(open) {
    els.progressHead.setAttribute('aria-expanded', String(open));
    els.steps.hidden = !open;
  }
  function resetSteps() { for (const [k] of CONFIG.steps) setStep(k, 'pending'); }
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  function chip(text, kind = '') {
    els.chip.hidden = !text;
    els.chip.textContent = text || '';
    els.chip.className = `status-chip ${kind}`.trim();
  }
  function tick() { const t = secs(performance.now() - state.t0); els.elapsed.textContent = t; chip(`Loading the site, ${t}`); }

  /* ---- metrics ------------------------------------------------------------------------- */
  function renderMetrics() {
    const r = state.result, box = els.metrics;
    box.textContent = '';
    if (!r) { box.append(h('p', { class: 'help' }, 'Metrics appear after the site loads.')); return; }
    const m = r.model, s = summarize(m), g = m.ground;
    const row = (k, v, small) => [h('dt', null, k), h('dd', null, v, small ? h('small', null, ` ${small}`) : null)];
    box.append(h('dl', { class: 'kv' },
      row('Buildings', grouped(s.buildings), s.estimated ? `${grouped(s.estimated)} estimated` : ''),
      row('Road length', fmtFt(s.roadsFt, 0)),
      row('Trees', grouped(s.trees)),
      row('Water areas', grouped(s.waterAreas)),
      row('Ground', `${grouped(s.groundMin, 1)} to ${grouped(s.groundMax, 1)} ft`),
      row('Grid spacing', fmtFt(g.spacing, 1)),
      row('Grid points', grouped(g.n * g.n), `${g.n} by ${g.n}`),
    ));
    if (state.removed.size) {
      box.append(h('div', { class: 'removed-line', id: 'removedLine' },
        h('span', { id: 'removedText' }, `Removed buildings: ${state.removed.size}`),
        h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
        h('button', { class: 'link-btn', type: 'button', id: 'restoreAll', onclick: restoreAll }, 'Restore all')));
    }
  }

  /* ---- remove and restore buildings ------------------------------------------------------------
     Click a building in the 3D view (Scene.onPick) to open the selection card. Remove takes it out of the solids
     (a dashed outline stays on the ground), Restore puts it back. Click its outline to select it again. The list is
     state.removed; it goes into the project as meta.removed on every project write (metaOf). */
  const RULE_TEXT = { data: 'height from the data', floors: 'height from the floor count', estimate: 'height estimated' };
  function renderCard() {
    const box = els.selCard, sel = state.selected;
    if (!box) return;
    box.textContent = '';
    box.hidden = !sel;
    if (!sel) return;
    const b = sel.building, gone = state.removed.has(baseId(sel.id));
    const floors = Math.max(1, Math.round(b.floors || b.height / 12));
    box.append(
      h('div', { class: 'sc-head' },
        h('div', { class: 'sc-titles' },
          h('div', { class: 'sc-title', id: 'selTitle' }, b.name || 'Building', gone ? h('span', { class: 'sc-tag' }, 'Removed') : null),
          h('div', { class: 'sc-sub', id: 'selSub' }, `Height ${fmtFt(b.height, 1)} · ${floors} ${floors === 1 ? 'floor' : 'floors'} · ${RULE_TEXT[b.rule] || b.rule}`),
          h('div', { class: 'sc-id', id: 'selId' }, `ID ${sel.id}`)),
        h('button', { class: 'btn icon sc-close', type: 'button', id: 'selClose', title: 'Close (Escape)', 'aria-label': 'Close the building card', onclick: () => selectHit(null) }, '×')),
      h('div', { class: 'sc-actions' },
        h('button', { class: gone ? 'btn outline' : 'btn solid', type: 'button', id: 'selAction', onclick: () => (gone ? restoreBuilding(sel.id) : removeBuilding(sel.id)) }, gone ? 'Restore' : 'Remove')));
  }
  /** Opens the card for a hit of Scene.pick (or closes it with null). */
  function selectHit(hit) {
    if (hit && state.busy) return;
    state.selected = hit ? { id: baseId(hit.id), building: hit.building } : null;
    Scene.select(state.selected ? state.selected.id : null);
    renderCard();
  }
  /** Replaces the removed set: rebuilds the buildings, redraws the panel line and the card, and writes the open project. */
  function setRemoved(ids) {
    state.removed = new Set([...(ids || [])].map(baseId));
    Scene.setRemoved(state.removed);
    renderMetrics();
    renderCard();
    if (state.result && project.doc && !project.readOnly && projectWrite(state.result)) scheduleProjectSave();
  }
  const removeBuilding = (id) => setRemoved([...state.removed, baseId(id)]);
  const restoreBuilding = (id) => setRemoved([...state.removed].filter((x) => x !== baseId(id)));
  const restoreAll = () => setRemoved([]);

  /* ---- recent sites ----------------------------------------------------------------------- */
  const loadRecents = () => { const v = Local.get(CONFIG.recentKey, []); return Array.isArray(v) ? v.filter((e) => e && e.text && e.size && Number.isFinite(e.lat) && Number.isFinite(e.lon)) : []; };
  function saveRecent(r) {
    const entry = { text: state.typed || r.loc.label, label: r.loc.label, lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, t: Date.now() };
    const list = loadRecents().filter((e) => !(e.text === entry.text && e.size === entry.size));
    list.unshift(entry);
    Local.set(CONFIG.recentKey, list.slice(0, CONFIG.recentMax));
    renderRecents();
  }
  function renderRecents() {
    const list = loadRecents(), box = els.recents;
    box.textContent = '';
    els.recentsWrap.hidden = !list.length;
    for (const e of list) {
      box.append(h('button', { class: 'recent', type: 'button', title: e.label, onclick: () => { els.addr.value = e.text; setSize(e.size); go({ text: e.text, size: e.size, loc: { lat: e.lat, lon: e.lon, label: e.label } }); } },
        h('span', { class: 't' }, e.text), h('span', { class: 's' }, `${grouped(e.size)} ft`)));
    }
  }

  /* ---- the Go action ------------------------------------------------------------------------- */
  function setBusy(b) {
    state.busy = b;
    els.go.disabled = b;
    els.go.textContent = b ? 'Working' : 'Go';
    els.viewport.dataset.busy = String(b && !!state.result);
    syncActions();
  }
  function setSize(v) {
    state.size = v;
    if (![...els.size.options].some((o) => o.value === String(v))) els.size.append(h('option', { value: String(v) }, `${grouped(v)} ft`));     // a size from a project file
    els.size.value = String(v);
  }

  async function go(req = {}) {
    if (state.busy) return;
    const text = (req.text != null ? req.text : els.addr.value).trim();
    if (!text) { Toast.show('Type an address, coordinates, or a Google Maps link first.', 'warn'); els.addr.focus(); return; }
    const size = req.size || state.size;
    const id = ++state.runId;
    const id0 = project.doc ? project.doc.id : null;
    els.progressSec.hidden = false;
    setProgressOpen(true);
    resetSteps();
    setBusy(true);
    state.t0 = performance.now();
    clearInterval(state.timer);
    state.timer = setInterval(tick, 200);
    tick();
    let r = null, failure = null;
    try {
      const runner = req.runFn || Pipeline.run;                       // runFn: the in-page tests give a result without the network
      r = await runner({ text, size, loc: req.loc }, (step, st, msg) => { if (id === state.runId) setStep(step, st, msg); }, { walks: !!state.layers.walks, fetchFn: req.fetchFn });
    } catch (e) { failure = e; }
    clearInterval(state.timer);
    const dt = performance.now() - state.t0;
    els.elapsed.textContent = secs(dt);
    setBusy(false);
    if (id !== state.runId) return;
    if (failure) {
      console.error(failure);
      chip(failure.message, 'bad');
      Toast.show(failure.message, 'bad', 8000);
      return;
    }
    state.typed = text;
    state.result = r;
    state.elapsed = dt;
    r.uiMs = Math.round(dt);
    if (!r.failed.length) setProgressOpen(false);          // all done: fold the list, one tap opens it
    // The removed list belongs to one site: another site clears it. On the same site, ids that no longer exist are dropped without a message.
    const key = siteKeyOf(r);
    if (state.removedKey && state.removedKey !== key) state.removed = new Set();
    state.removedKey = key;
    const have = new Set(r.model.buildings.map((b) => baseId(b.id)));
    state.removed = new Set([...state.removed].filter((x) => have.has(x)));
    state.selected = null;
    renderCard();
    const t1 = performance.now();
    Scene.setModel(r.model, state.removed);
    r.timings.scene = Math.round(performance.now() - t1);
    els.empty.hidden = true;
    renderMetrics();
    syncActions();
    if (!req.runFn) saveRecent(r);
    if (project.doc && (!id0 || id0 === project.doc.id) && projectWrite(r)) scheduleProjectSave();      // a project is open: the site goes into it
    const bad = r.failed.map((k) => CONFIG.steps.find((s) => s[0] === k)[1]);
    chip(bad.length ? `Loaded in ${secs(dt)}. Not loaded: ${bad.join(', ')}` : `Loaded in ${secs(dt)}`, bad.length ? 'bad' : '');
    if (bad.length) Toast.show(`${bad.join(' and ')} could not be loaded. The rest of the site is shown.`, 'warn', 7000);
    else setTimeout(() => { if (!state.busy) chip(''); }, 5000);
  }

  /* ---- layers, scale, contours ------------------------------------------------------------------ */
  function toggleLayer(key, on) {
    state.layers[key] = on;
    for (const b of els.toggles.querySelectorAll('[data-layer]')) if (b.dataset.layer === key) b.setAttribute('aria-checked', String(on));
    if (key === 'walks' && on && state.result && !state.result.model.roads.walks) {
      chip('Building walks');
      setTimeout(() => {
        try {
          const roads = Pipeline.buildWalks(state.result);
          Scene.setWalks(roads);
          Scene.setLayer('walks', state.layers.walks);
          chip(`${roads.walks ? roads.walks.length : 0} walk areas added`);
          if (project.doc && !project.readOnly && projectWrite(state.result)) scheduleProjectSave();
          setTimeout(() => { if (!state.busy) chip(''); }, 2500);
        } catch (e) { console.error(e); chip(''); Toast.show(`Walks could not be built. ${e.message}`, 'bad', 6000); }
      }, 20);
    }
    Scene.setLayer(key, on);
  }
  function setSegPressed(group, attr, val) {
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset[attr]) === val));
  }
  function setVScale(v) { state.vscale = v; setSegPressed(els.scaleSeg, 'scale', v); Scene.setVScale(v); }
  function setContour(v) { state.contour = v; setSegPressed(els.contourSeg, 'contour', v); Scene.setContour(v); }

  /* ---- downloads and screenshot -------------------------------------------------------------------- */
  const FILES = {
    csv: { suffix: 'topo.csv', type: 'text/csv', make: (r) => revitCsv(r.model.ground) },
    dxf: { suffix: 'site.dxf', type: 'application/dxf', make: (r) => siteDxf(r.model, { removed: new Set(state.removed) }) },
    notes: { suffix: 'notes.md', type: 'text/markdown', make: (r) => notesMarkdown(r.model, metaOf(r)) },
    // SketchUp: the name comes from sketchupFilename (slug + date) and the file is a Blob made by docToBlob
    sketchup: { type: 'application/json', name: (r) => sketchupFilename(slugOf(r), new Date()), blob: (r) => docToBlob(siteToSketchup(r.model, metaOf(r))) },
  };
  function fileFor(kind, r = state.result) {
    const f = FILES[kind];
    if (f.blob) return { name: f.name(r), blob: f.blob(r), type: f.type };
    return { name: `${slugOf(r)}-${f.suffix}`, text: f.make(r), type: f.type };
  }
  /** The SketchUp document for a result (default: the current site). */
  function sketchupDoc(r = state.result) { return r ? siteToSketchup(r.model, metaOf(r)) : null; }
  async function download(kind) {
    Pop.close();
    if (!state.result) return;
    try {
      const f = fileFor(kind);
      const res = await ShotMod.deliverImage(f.blob || new Blob([f.text], { type: f.type }), f.name);
      if (res === 'downloaded') Toast.show(`Saved ${f.name}`);
    } catch (e) { console.error(e); Toast.show(`The file could not be made. ${e.message}`, 'bad', 6000); }
  }
  function openDownloads() {
    const item = (kind, title, sub) => h('button', { class: 'pop-item', type: 'button', 'data-dl': kind, onclick: () => download(kind) }, h('span', { class: 'grow' }, title, h('small', null, sub)));
    Pop.open(els.btnDl, h('div', { role: 'menu' },
      item('csv', 'Revit CSV', 'Ground points for a Revit toposolid'),
      item('dxf', 'DXF', 'Topo mesh, buildings, roads, trees, water'),
      item('sketchup', 'SketchUp', 'Ground, buildings, roads, water. Import with the CMRLM extension'),
      item('notes', 'Notes', 'Origin, counts, and Revit import steps')));
  }
  function overlayMetrics(r) {
    const s = summarize(r.model);
    return [
      ['Site', `${grouped(r.frame.size)} ft square`],
      ['Buildings', `${grouped(s.buildings)}${s.estimated ? ` (${grouped(s.estimated)} est.)` : ''}`],
      ['Roads', fmtFt(s.roadsFt, 0)],
      ['Trees', grouped(s.trees)],
      ['Ground', `${grouped(s.groundMin, 1)} to ${grouped(s.groundMax, 1)} ft`],
    ];
  }
  async function screenshot({ deliver = true } = {}) {
    const r = state.result;
    if (!r) return null;
    try {
      const blob = await Scene.capture({ title: state.typed || r.loc.label, date: true, metrics: overlayMetrics(r), mark: 'CMRLM', theme: prefersDark() ? 'dark' : 'light' }, 2);
      if (deliver) {
        const res = await ShotMod.deliverImage(blob, ShotMod.screenshotFilename(slugOf(r)));
        if (res === 'downloaded') Toast.show('Image saved to your downloads.');
      }
      return blob;
    } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The image could not be made.', 'bad', 6000); return null; }
  }

  /* ---- Google Maps ------------------------------------------------------------------------------------ */
  function currentPoint() {
    const typed = parseCoordinates(els.addr.value);
    if (typed) return typed;
    return state.result ? { lat: state.result.loc.lat, lon: state.result.loc.lon } : null;
  }
  function openMaps() {
    const p = currentPoint();
    if (!p) return;
    window.open(googleMapsUrl(p.lat, p.lon), '_blank', 'noopener');
  }
  function syncActions() {
    const has = !!state.result;
    els.btnMaps.disabled = !currentPoint();
    els.btnDl.disabled = !has || state.busy;
    els.btnShot.disabled = !has || state.busy;
    els.btnFit.disabled = els.btnPlan.disabled = !has;
    const canSend = has && !state.busy;
    els.btnSendTower.disabled = !canSend;
    els.btnSendTower.title = canSend ? 'Save this site in a project and open the Tower Generator' : 'Load a site first';
    els.btnSendMid.disabled = !canSend;
    els.btnSendMid.title = canSend ? 'Save this site in a project and open the Mid-Rise Generator' : 'Load a site first';
    els.btnSendGrading.disabled = !canSend;
    els.btnSendGrading.title = canSend ? 'Save this site in a project and open the Grading Sketch' : 'Load a site first';
  }

  /* ---- project file (docs/project-file-spec.md, sections 8 and 12) ----------------------------------------------
     With ?project=<id> the page opens that project, shows its name, loads the saved site again, and writes the
     "site" section after every run (saved 1 s later, and when the page is hidden). Without a project, nothing here
     runs until the Project menu or a Send button is used. Every storage call is inside try/catch.
     ProjectMod.writeSection returns a new project and does not change the one it gets. So a run only queues its
     section (project.pending). The save loads the project fresh from storage, writes the section on that copy and
     saves it, so sections that another tool saved from a second tab are kept (spec section 8, Conflicts). */
  const READ_ONLY_TEXT = 'This project was saved by a newer version of this tool. You can view it, but changes will not be saved.';
  const NO_STORAGE_TEXT = 'Saving is unavailable in this browser, so the project is kept only until you close this page.';
  const MOVED_TEXT = 'The site of this project changed. Work from other tools in this project may need a new placement.';
  const megabytes = (b) => `${(b / 1048576).toFixed(1)} MB`;
  const projectHref = (id) => `${location.pathname}?project=${encodeURIComponent(id)}`;
  function storageOf() {
    if (project.storage) return project.storage;
    try { return window.localStorage; } catch (e) { return null; }
  }
  /** Shows a notice one time per page, by key. */
  function noticeOnce(key, message, kind = 'warn', ms = 9000) {
    if (project.noted[key]) return;
    project.noted[key] = true;
    Toast.show(message, kind, ms);
  }
  /** The last argument of the storage functions of ProjectMod: each message becomes one toast. */
  const storageNotice = () => ({ onNotice: (message) => noticeOnce(`storage:${message}`, String(message)) });
  function renderProjectPill() {
    const pill = els.projPill, doc = project.doc;
    if (!pill) return;
    pill.hidden = !doc;
    if (!doc) return;
    pill.textContent = `Project: ${doc.name}${project.readOnly ? ' (read only)' : ''}`;
    pill.title = pill.textContent;
  }

  /** Makes `doc` the open project and checks that this page may write to it. It does not load the site (see siteRequest). */
  function openProjectDoc(doc) {
    if (project.doc) flushProject();
    clearTimeout(project.timer);
    Object.assign(project, { doc, timer: 0, pending: null, dirty: false, written: null, readOnly: false });
    let sec = null;
    try { sec = ProjectMod.getSection(doc, 'site'); } catch (e) { sec = null; }
    if ((sec && Number(sec.schema) > CONFIG.projectSchema) || Number(doc.version) > Number(ProjectMod.VERSION || 1)) {
      project.readOnly = true;
      noticeOnce('readonly', READ_ONLY_TEXT);
    }
    renderProjectPill();
    syncActions();
    return doc;
  }
  /** Forgets the open project. The saved copy stays where it is. */
  function projectClose() {
    clearTimeout(project.timer);
    Object.assign(project, { doc: null, timer: 0, pending: null, dirty: false, written: null, readOnly: false });
    renderProjectPill();
    syncActions();
  }

  const siteFrameOf = (r) => ({ kind: 'site', lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, zDatum: 'NAVD88' });
  /**
   * The Site Model owns the project frame (spec section 4). Sets `want` as the frame of `doc` (a copy that belongs to
   * this page). Returns true when the frame changed while other tools hold work in the project.
   */
  function adoptSiteFrame(doc, want) {
    const have = doc.frame || {};
    if (have.kind === 'site' && have.lat === want.lat && have.lon === want.lon && have.size === want.size && have.zDatum === want.zDatum) return false;
    doc.frame = { ...have, ...want };
    return Object.keys(doc.sections || {}).some((k) => {
      const sec = doc.sections[k];
      return k !== 'site' && sec && ((sec.state && Object.keys(sec.state).length) || (sec.derived && Object.keys(sec.derived).length));
    });
  }

  /** Queues the site of a run as the "site" section of the open project. flushProject writes it and saves the project. */
  function projectWrite(r = state.result) {
    if (!project.doc || !r) return false;
    if (project.readOnly) { noticeOnce('readonly', READ_ONLY_TEXT); return false; }
    const meta = projectMeta(r);
    try {
      project.pending = {
        section: {
          tool: 'site', schema: CONFIG.projectSchema, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 },
          state: siteState(meta), derived: siteDerived(r.model, meta), note: `${meta.address}, ${grouped(meta.size)} ft`,
        },
        frame: siteFrameOf(r),
      };
    } catch (e) {
      console.error(e);
      Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return false;
    }
    project.written = { result: r, walks: meta.walks };
    return true;
  }

  function scheduleProjectSave() {
    clearTimeout(project.timer);
    project.timer = setTimeout(flushProject, CONFIG.projectSaveMs);
  }
  function saveFailureText(doc, res) {
    if (!res) return NO_STORAGE_TEXT;
    let text = String(res.warning || 'The project could not be saved.');
    if (res.bytes > (ProjectMod.SIZE_MAX || 4 * 1024 * 1024)) {
      let sec = null;
      try { sec = ProjectMod.getSection(doc, 'site'); } catch (e) { sec = null; }
      if (sec && sec.derived) text += ` The site data is ${megabytes(derivedBytes(sec.derived))}. A smaller site size gives a smaller file.`;
    }
    return text;
  }
  /**
   * Writes the queued site section and saves the project. The project is loaded fresh from storage first (another tool
   * may have saved its section from a second tab), the section is written on that copy, and the copy is saved.
   * Returns the result of saveProject, { ok: true, skipped: true } when there is nothing to save, or { ok: false }.
   */
  function flushProject() {
    clearTimeout(project.timer);
    project.timer = 0;
    const doc = project.doc, patch = project.pending;
    if (!doc || project.readOnly || (!patch && !project.dirty)) return { ok: true, skipped: true };
    const opts = storageNotice();
    if (patch) {
      let base = doc;
      try { base = ProjectMod.loadProject(storageOf(), doc.id, opts) || doc; } catch (e) { base = doc; }
      let next = null;
      try { next = ProjectMod.writeSection(base, 'site', patch.section); } catch (e) {
        project.pending = null;
        if (e && e.readOnly) { project.readOnly = true; renderProjectPill(); noticeOnce('readonly', e.message || READ_ONLY_TEXT); return { ok: false, readOnly: true }; }
        console.error(e);
        Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
        return { ok: false };
      }
      const moved = adoptSiteFrame(next, patch.frame);
      Object.assign(project, { doc: next, pending: null, dirty: true });
      if (moved) noticeOnce('moved', MOVED_TEXT);
    }
    let res = null;
    try { res = ProjectMod.saveProject(storageOf(), project.doc, opts); } catch (e) { console.error(e); }
    if (!res || res.ok === false) {                           // the project stays dirty in memory: the next trigger tries again
      noticeOnce(`save:${(res && res.warning) || ''}`, saveFailureText(project.doc, res), 'bad', 12000);
      return res || { ok: false };
    }
    project.dirty = false;
    if (res.warning) noticeOnce('warning', String(res.warning));
    return res;
  }
  let projectEventsWired = false;
  function wireProjectEvents() {
    if (projectEventsWired) return;
    projectEventsWired = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushProject(); });
    window.addEventListener('pagehide', () => { flushProject(); });
  }

  function defaultProjectName() {
    const r = state.result;
    return (state.typed || (r && r.loc && r.loc.label) || els.addr.value || '').trim().slice(0, 80) || 'New project';
  }
  /** New project. With a site on screen it is a site project and gets the site section; without a site it has a local frame. */
  function projectCreate(name, { quiet = false } = {}) {
    flushProject();
    const r = state.result;
    const title = String(name || '').trim().slice(0, 80) || defaultProjectName();
    let doc;
    try { doc = r ? ProjectMod.newProject({ name: title, frame: siteFrameOf(r) }) : ProjectMod.newProject({ name: title }); } catch (e) {
      console.error(e);
      Toast.show(`The project could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return null;
    }
    openProjectDoc(doc);
    if (r) projectWrite(r); else project.dirty = true;
    const saved = flushProject();
    project.updateUrl(doc.id);
    if (!quiet && saved && saved.ok !== false) Toast.show(`Project ${project.doc.name} created.`);
    return project.doc;
  }
  /** Send: the project holds the site (made now when none is open), then the next tool opens with ?project=<id>. */
  async function projectSend(toolId) {
    Pop.close();
    const r = state.result;
    if (!['tower', 'midrise', 'grading'].includes(toolId) || !r || state.busy) return false;
    if (project.readOnly) { noticeOnce('readonly', READ_ONLY_TEXT); return false; }
    if (!project.doc) {
      if (!projectCreate(defaultProjectName(), { quiet: true })) return false;
    } else {
      const w = project.written, walks = projectMeta(r).walks;
      if ((!w || w.result !== r || w.walks !== walks) && !projectWrite(r)) return false;
    }
    const saved = flushProject();
    if (saved && saved.ok === false) return false;
    let url = null;
    try { url = ProjectMod.sendTo(storageOf(), project.doc, toolId, 'site', storageNotice()); } catch (e) {
      console.error(e);
      Toast.show(`The project could not be sent. ${e && e.message ? e.message : ''}`.trim(), 'bad', 8000);
      return false;
    }
    if (!url) { Toast.show('The project could not be sent.', 'bad', 8000); return false; }
    try { project.doc = ProjectMod.loadProject(storageOf(), project.doc.id, storageNotice()) || project.doc; } catch (e) { /* keep the copy in memory */ }     // sendTo saved a copy with a log entry
    project.dirty = false;
    project.navigate(url);
    return url;
  }
  function projectOpen(id) { flushProject(); project.navigate(projectHref(id)); }
  async function projectExport() {
    const doc = project.doc;
    if (!doc) return;
    flushProject();
    try {
      const { filename, blob } = ProjectMod.exportProject(doc);
      const res = await ShotMod.deliverImage(blob, filename);
      if (res === 'downloaded') Toast.show(`Saved ${filename}`);
    } catch (e) { console.error(e); Toast.show(`The project file could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', 6000); }
  }
  async function projectImport(file) {
    flushProject();
    try {
      const res = await ProjectMod.importProject(file, storageOf(), storageNotice());
      const doc = res && res.doc;
      if (!doc) throw new Error('The file could not be read.');
      openProjectDoc(doc);
      project.updateUrl(doc.id);
      Toast.show(res.renamed ? `Imported as ${doc.name}.` : `Imported ${doc.name}.`);
      if (res.warning) noticeOnce('warning', String(res.warning));
      const req = siteRequest(doc);
      if (req && !state.busy) go(req);
    } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The file could not be imported.', 'bad', 8000); }
  }

  /** The request for go() that loads the saved site of a project, or null. It also fills the address field, the size menu and the walks layer. */
  function siteRequest(doc) {
    let sec = null;
    try { sec = ProjectMod.getSection(doc, 'site'); } catch (e) { return null; }
    const st = sec && sec.state, size = st ? Number(st.size) : NaN;
    if (!st || typeof st.query !== 'string' || !st.query.trim() || !(size > 0)) return null;
    els.addr.value = st.query;
    setSize(size);
    state.removed = new Set(Array.isArray(st.removed) ? st.removed.filter((x) => typeof x === 'string').map(baseId) : []);     // applied when the model lands (go prunes it)
    state.removedKey = null;
    if (st.walks && !state.layers.walks) {                    // the run builds the walks; the layer only has to be on
      state.layers.walks = true;
      for (const b of els.toggles.querySelectorAll('[data-layer="walks"]')) b.setAttribute('aria-checked', 'true');
      Scene.setLayer('walks', true);
    }
    syncActions();
    const loc = Number.isFinite(st.lat) && Number.isFinite(st.lon) ? { lat: st.lat, lon: st.lon, label: st.query } : undefined;
    return { text: st.query, size, loc };
  }
  /** On start: with ?project=<id> open that project and run its saved site. Returns true when a project was opened. */
  function startProject({ fetchFn, runFn } = {}) {
    let id = null;
    try { id = ProjectMod.projectIdFromUrl(location); } catch (e) { id = null; }
    if (!id) return false;
    let doc = null, told = false;
    try { doc = ProjectMod.loadProject(storageOf(), id, { onNotice: (message) => { told = true; noticeOnce(`storage:${message}`, String(message)); } }); } catch (e) { console.error(e); }
    if (!doc) {
      if (!told) Toast.show('That project could not be opened. It may have been deleted, or it was saved in another browser.', 'warn', 9000);
      return false;
    }
    openProjectDoc(doc);
    const req = siteRequest(doc);
    if (req) go({ ...req, fetchFn, runFn });
    return true;
  }

  /* ---- Project menu ---- */
  const whenText = (t) => { try { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  const bytesText = (b) => (Number.isFinite(b) && b > 0 ? (b >= 1048576 ? megabytes(b) : `${Math.max(1, Math.round(b / 1024))} KB`) : '');
  function openProjectMenu() {
    const el = h('div', { role: 'menu', id: 'projectMenu' });
    const item = (key, title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', 'data-proj': key, 'data-project-id': o.id, disabled: o.disabled, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null));

    // New project: the row turns into a name field
    const nameField = h('input', { class: 'pop-name', id: 'projName', type: 'text', maxlength: '80', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done', 'aria-label': 'Project name', placeholder: 'Project name', value: defaultProjectName() });
    const create = () => { Pop.close(); projectCreate(nameField.value); };
    nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    const newRow = item('new', 'New project', state.result ? 'Save this site in a new project' : 'Start a project without a site', () => { newRow.hidden = true; form.hidden = false; nameField.focus(); nameField.select(); }, { keep: true });
    const form = h('div', { class: 'proj-new', id: 'projNewForm', hidden: true }, nameField,
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn outline', type: 'button', id: 'projCancel', onclick: () => { form.hidden = true; newRow.hidden = false; } }, 'Cancel'),
        h('button', { class: 'btn solid', type: 'button', id: 'projCreate', onclick: create }, 'Create')));
    el.append(newRow, form, h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Open'));

    // Open: the newest projects
    let list = [];
    try { list = ProjectMod.listProjects(storageOf(), storageNotice()) || []; } catch (e) { console.error(e); noticeOnce('storage', NO_STORAGE_TEXT); }
    if (!list.length) el.append(h('div', { class: 'pop-note' }, 'No saved projects yet.'));
    for (const p of list.slice(0, CONFIG.projectListMax)) {
      const here = !!project.doc && p.id === project.doc.id;
      el.append(item('open', p.name, [here ? 'Open now' : whenText(p.updatedAt), bytesText(p.bytes)].filter(Boolean).join(' · '), () => projectOpen(p.id), { id: p.id, disabled: here }));
    }
    if (list.length > CONFIG.projectListMax) el.append(item('all', 'All projects', `${list.length - CONFIG.projectListMax} more on the menu page`, () => { flushProject(); project.navigate('../'); }));

    el.append(h('div', { class: 'pop-sep' }),
      item('import', 'Import', 'Add a project file (.cmrlm.json)', () => $('projFile').click()),
      item('export', 'Export', project.doc ? `Download ${project.doc.name} as a file` : 'Open or create a project first', projectExport, { disabled: !project.doc }));
    Pop.open(els.btnProject, el);
  }

  /* ---- DOM ---------------------------------------------------------------------------------------------- */
  const tbBtn = (id, icon, text, title, onclick, extra) => h('button', { class: 'btn has-text', type: 'button', id, title, 'aria-label': title, onclick, ...extra },
    h('span', { html: icon, style: 'display:contents' }), h('span', { class: 'btn-text' }, text));

  function buildTopbar() {
    els.btnMaps = tbBtn('btnMaps', ICONS.map, 'Google Maps', 'Open this place in Google Maps (a visual reference)', openMaps);
    els.btnDl = tbBtn('btnDownloads', ICONS.download, 'Downloads', 'Downloads: Revit CSV, DXF, SketchUp, Notes', openDownloads, { 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    els.btnDl.append(h('span', { html: ICONS.chev, style: 'display:contents' }));
    els.btnShot = tbBtn('btnShot', ICONS.camera, 'Screenshot', 'Save a picture of the 3D view', () => screenshot());
    els.btnProject = tbBtn('btnProject', ICONS.folder, 'Project', 'Project: new, open, import, export', openProjectMenu, { 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    els.btnProject.append(h('span', { html: ICONS.chev, style: 'display:contents' }));
    els.btnSendTower = tbBtn('btnSendTower', ICONS.tower, 'Send to Tower Generator', 'Load a site first', () => projectSend('tower'), { class: 'btn has-text send', disabled: true });
    els.btnSendMid = tbBtn('btnSendMidrise', ICONS.midrise, 'Send to Mid-Rise Generator', 'Load a site first', () => projectSend('midrise'), { class: 'btn has-text send', disabled: true });
    els.btnSendGrading = tbBtn('btnSendGrading', ICONS.grading, 'Send to Grading Sketch', 'Load a site first', () => projectSend('grading'), { class: 'btn has-text send', disabled: true });
    $('tbActions').append(els.btnMaps, els.btnDl, els.btnShot, h('span', { class: 'tb-sep', 'aria-hidden': 'true' }), els.btnProject, els.btnSendTower, els.btnSendMid, els.btnSendGrading);
  }

  function toggleRow(key, label) {
    const b = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!state.layers[key]), 'data-layer': key, onclick: () => toggleLayer(key, !state.layers[key]) },
      h('span', null, label), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    return b;
  }
  function seg(values, attr, label, current, onPick, labels) {
    const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    for (const v of values) g.append(h('button', { type: 'button', [`data-${attr}`]: v, 'aria-pressed': String(v === current), onclick: () => onPick(v) }, labels(v)));
    return g;
  }

  function buildPanel() {
    const sections = $('sections');

    // Site
    els.addr = h('input', { class: 'field', id: 'addr', type: 'text', placeholder: '3615 W Cypress St, Tampa, FL', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Address, coordinates, or Google Maps link', 'aria-describedby': 'addrHint' });
    els.go = h('button', { class: 'btn solid', type: 'button', id: 'goBtn', onclick: () => go() }, 'Go');
    els.addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); els.addr.blur(); go(); } });
    els.addr.addEventListener('input', syncActions);
    els.size = h('select', { id: 'sizeSel', 'aria-label': 'Site size' }, CONFIG.sizes.map((s) => h('option', { value: String(s) }, `${grouped(s)} ft`)));
    els.size.value = String(state.size);
    els.size.addEventListener('change', () => { state.size = Number(els.size.value); });
    els.recents = h('div', { class: 'recents' });
    els.recentsWrap = h('div', null, h('div', { class: 'label', style: 'padding:10px 0 2px' }, 'Recent sites'), els.recents);
    sections.append(h('div', { class: 'sec' },
      h('div', { class: 'label' }, 'Location'),
      h('div', { class: 'addr-row' }, els.addr, els.go),
      h('p', { class: 'help', id: 'addrHint' }, 'Address, lat/lon, or a Google Maps link'),
      h('div', { class: 'select-row' }, h('label', { for: 'sizeSel' }, 'Site size (square)'), els.size),
      els.recentsWrap));

    // Progress
    els.steps = h('ul', { class: 'steps', id: 'steps' }, CONFIG.steps.map(([k, label]) =>
      h('li', { 'data-step': k, 'data-s': 'pending' }, h('span', { class: 'ic' }), h('span', null, h('span', { class: 'nm' }, label), h('span', { class: 'ms' }, 'Waiting')))));
    els.elapsed = h('span', { class: 'aside', id: 'elapsed' });
    els.progressHead = h('button', { class: 'label sec-head', type: 'button', id: 'progressHead', 'aria-expanded': 'true', onclick: () => setProgressOpen(els.progressHead.getAttribute('aria-expanded') !== 'true') },
      h('span', { class: 'sec-title' }, h('span', { html: ICONS.chev, style: 'display:contents' }), 'Progress'), els.elapsed);
    els.progressSec = h('div', { class: 'sec', id: 'progressSec', hidden: true }, els.progressHead, els.steps);
    sections.append(els.progressSec);

    // Layers
    els.toggles = h('div', { class: 'toggles' }, CONFIG.layers.map(([k, l]) => toggleRow(k, l)));
    sections.append(h('div', { class: 'sec' }, h('div', { class: 'label' }, 'Layers'), els.toggles));

    // View
    els.scaleSeg = seg(CONFIG.scales, 'scale', 'Vertical scale', state.vscale, setVScale, (v) => `${v}×`);
    els.contourSeg = seg(CONFIG.contours, 'contour', 'Contour lines', state.contour, setContour, (v) => (v ? `${v} ft` : 'Off'));
    sections.append(h('div', { class: 'sec' }, h('div', { class: 'label' }, 'View'),
      h('div', { class: 'ctl-block' }, h('span', { class: 'ctl-label' }, 'Vertical scale'), els.scaleSeg),
      h('div', { class: 'ctl-block' }, h('span', { class: 'ctl-label' }, 'Contour lines'), els.contourSeg)));

    // Metrics
    els.metrics = h('div', { id: 'metrics' });
    sections.append(h('div', { class: 'sec' }, h('div', { class: 'label' }, 'Site data'), els.metrics));
    renderMetrics();

    // Help: remove buildings (copy in docs/site-remove-copy.md)
    els.help = h('details', { class: 'sec help-sec', id: 'helpSec' },
      h('summary', { class: 'label' }, h('span', { class: 'sec-title' }, h('span', { html: ICONS.chev, style: 'display:contents' }), 'Remove buildings')),
      h('p', { class: 'help-text', id: 'helpRemove' }, HELP_REMOVE));
    sections.append(els.help);

    sections.append(h('p', { class: 'credits' }, CREDITS));
  }

  function buildViews() {
    els.btnFit = h('button', { type: 'button', id: 'btnFit', 'aria-pressed': 'false', title: 'Fit the whole site in the view', onclick: () => Scene.fit(true) }, 'Fit');
    els.btnPlan = h('button', { type: 'button', id: 'btnPlan', 'aria-pressed': 'false', title: 'Look straight down', onclick: () => Scene.planView(true) }, 'Plan');
    $('views').append(els.btnFit, els.btnPlan);
    Scene.onPreset((p) => { els.btnFit.setAttribute('aria-pressed', String(p === 'fit')); els.btnPlan.setAttribute('aria-pressed', String(p === 'plan')); });
  }

  function buildCompass() {
    const rose = $('compassRose'), nLabel = $('compassN'), v = new THREE.Vector3(0, 0, -1);
    let last = NaN;
    Scene.onCamera((cam) => {
      v.set(0, 0, -1).transformDirection(cam.matrixWorldInverse);
      const a = Math.atan2(v.x, v.y);
      if (Math.abs(a - last) < 1e-3) return;
      last = a;
      rose.setAttribute('transform', `rotate(${(a * 180 / Math.PI).toFixed(1)} 24 24)`);
      nLabel.setAttribute('x', (24 + 17.6 * Math.sin(a)).toFixed(2));
      nLabel.setAttribute('y', (24 - 17.6 * Math.cos(a) + 2.4).toFixed(2));
    });
  }

  /* ---- bottom sheet (iPad portrait and phone) ------------------------------------------------------------- */
  function initSheet() {
    const app = $('app'), grabber = $('grabber');
    const GRAB = 44;
    const total = () => app.clientHeight;
    const lowest = () => GRAB + 40;
    const snaps = () => [lowest(), Math.round(total() * 0.42), Math.round(total() * 0.86)];
    const setH = (px) => app.style.setProperty('--sheet-h', `${Math.round(clamp(px, lowest(), total() * 0.9))}px`);
    const curH = () => $('panel').getBoundingClientRect().height;
    const animateTo = (to) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setH(to);
      const from = curH(), t0 = performance.now();
      const step = (now) => {
        const p = clamp((now - t0) / 180, 0, 1);
        setH(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    let drag = null;
    grabber.addEventListener('pointerdown', (e) => { grabber.setPointerCapture(e.pointerId); drag = { y: e.clientY, h: curH(), moved: false }; });
    grabber.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) setH(drag.h + dy);
    });
    const end = () => {
      if (!drag) return;
      const s = snaps(), now = curH();
      if (!drag.moved) animateTo(s.find((v) => v > now + 8) || s[0]);
      else animateTo(s.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a)));
      drag = null;
    };
    grabber.addEventListener('pointerup', end);
    grabber.addEventListener('pointercancel', end);
    grabber.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      setH(curH() + (e.key === 'ArrowUp' ? 60 : -60));
    });
    const reset = () => { if (sheetQuery.matches) setH(total() * 0.42); else app.style.removeProperty('--sheet-h'); };
    (sheetQuery.addEventListener ? sheetQuery.addEventListener('change', reset) : sheetQuery.addListener(reset));
    reset();
    window.addEventListener('resize', () => { if (sheetQuery.matches) { const px = parseFloat(app.style.getPropertyValue('--sheet-h')); if (px) setH(px); } });
  }

  function init() {
    els.viewport = $('viewport'); els.chip = $('statusChip'); els.empty = $('emptyState'); els.projPill = $('projPill'); els.selCard = $('selCard');
    buildTopbar();
    buildPanel();
    buildViews();
    initSheet();
    renderRecents();
    syncActions();
    const projFile = $('projFile');
    projFile.addEventListener('change', async () => {
      const file = projFile.files && projFile.files[0];
      projFile.value = '';
      if (file) await projectImport(file);
    });
    wireProjectEvents();
    Scene.onPick((hit) => selectHit(hit));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !state.selected) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      selectHit(null);
    });
    return true;
  }

  return {
    init, go, buildCompass, screenshot, download, fileFor, sketchupDoc, openDownloads, toggleLayer, setVScale, setContour, setSize, openMaps, syncActions,
    setRemoved, removeBuilding, restoreBuilding, restoreAll, selectHit, renderCard,
    state, els, metaOf, slugOf, renderMetrics, setStep,
    project, startProject, openProjectDoc, projectClose, projectCreate, projectWrite, projectSend, scheduleProjectSave, flushProject, siteRequest, openProjectMenu, projectMeta,
  };
})();
