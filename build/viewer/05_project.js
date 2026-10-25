/* ==========================================================================
   PROJECT (view only)
   Opens a saved project for reading (?project=<id> or the Project menu), or a project file in memory. This part has NO write path:
   it never calls writeSection, saveProject or importProject (which saves), and it never sets or removes a project key.
   It reads with listProjects and loadProject, and it saves a copy of the open project to disk only through Export (a download).
   An imported file stays in memory only: the project is not in the list, so the "Edit in" links are off for it.
   ========================================================================== */
const ViewerProject = (() => {
  const storage = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const listeners = [];
  let note = '';
  const notice = (m) => { note = m; Toast.show(m, 'warn', 6000); };
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  function list() {
    if (!storage) return [];
    try { return ProjectMod.listProjects(storage, { onNotice: notice }); } catch (e) { return []; }
  }
  function open(id) {
    note = '';
    if (!storage) { notice('This browser does not give the page its saved projects.'); return false; }
    let doc = null;
    try { doc = ProjectMod.loadProject(storage, id, { onNotice: notice }); } catch (e) { doc = null; }
    if (!doc) { if (!note) notice('This project could not be opened.'); return false; }
    note = '';
    openDoc(doc, 'saved');
    try { history.replaceState(null, '', `?project=${encodeURIComponent(doc.id)}${TEST_MODE ? '&test' : ''}`); } catch (e) { /* the address stays as it is */ }
    return true;
  }
  /** Shows a project document. src: 'saved' | 'file'. The document is read, never changed. */
  function openDoc(doc, src = 'file') {
    Model.load(doc, src);
    Render.select(null);
    for (const id of TOGGLE_LAYERS) if (!Model.hasData(id)) { /* a layer without data stays off in the list; its toggle is disabled */ }
    State.changed();
    emit();
    return true;
  }
  function close() { Model.load(null); Render.select(null); State.changed(); emit(); try { history.replaceState(null, '', location.pathname + (TEST_MODE ? '?test' : '')); } catch (e) { /* ignore */ } }

  /** Reads a project file into memory. Resolves { doc }. Rejects with a message for the person. Nothing is saved. */
  async function importFile(file) {
    if (!file) throw new Error('No file was chosen.');
    if (typeof file !== 'string' && typeof file.size === 'number' && file.size > 8 * 1024 * 1024) throw new Error('That file is too large to be a project file.');
    let text;
    try { text = typeof file === 'string' ? file : await file.text(); } catch (e) { throw new Error('The file could not be read.'); }
    let obj;
    try { obj = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (e) { throw new Error('This file is not valid JSON, so it is not a project file.'); }
    if (!obj || typeof obj !== 'object' || obj.format !== ProjectMod.FORMAT) throw new Error('This file is not a design tools project file.');
    if (Number.isFinite(obj.version) && obj.version > ProjectMod.VERSION) throw new Error('This file was made by a newer version of the design tools. Update the tools and try again.');
    const doc = ProjectMod.migrate(obj);
    const check = ProjectMod.validate(doc);
    if (!check.ok) throw new Error(`This project file is not valid: ${check.errors[0]}.`);
    openDoc(doc, 'file');
    return { doc };
  }
  function pickFile() { const input = $('projFile'); input.value = ''; input.click(); }
  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { await importFile(f); Toast.show('The file is open in the viewer only. It is not saved to your project list.'); } catch (err) { Toast.show(err && err.message ? err.message : 'The file could not be opened.', 'bad', 6000); }
  }

  /** Downloads the open project as a .cmrlm.json file (a copy; nothing is saved in the browser). */
  function exportFile() {
    const doc = Model.doc();
    if (!doc) return null;
    const out = ProjectMod.exportProject(doc);
    if (out.blob) {
      const url = URL.createObjectURL(out.blob);
      const a = h('a', { href: url, download: out.filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      Toast.show('Project file saved to your downloads.');
    }
    return out;
  }

  const when = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  /** The project list as buttons (the empty state and the Project menu). */
  function listButtons(onPick) {
    const items = list();
    if (!items.length) return [h('p', { class: 'help empty-none' }, 'There are no saved projects in this browser. Make one in a tool, or import a project file.')];
    return items.map((p) => h('button', { class: 'pop-item proj-row', type: 'button', 'data-project': p.id, onclick: () => { if (onPick) onPick(); open(p.id); } },
      h('span', { class: 'grow' }, p.name, h('small', null, [when(p.updatedAt), p.bytes ? `${Math.round(p.bytes / 1024)} KB` : ''].filter(Boolean).join(', ')))));
  }
  function openMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'projectMenu' });
    el.append(h('div', { class: 'label pop-label' }, 'Open'), ...listButtons(() => Pop.close()),
      h('div', { class: 'pop-sep' }),
      h('button', { class: 'pop-item', type: 'button', id: 'miImport', onclick: () => { Pop.close(); pickFile(); } }, h('span', { class: 'grow' }, 'Import', h('small', null, 'Open a project file. It is not saved.'))),
      h('button', { class: 'pop-item', type: 'button', id: 'miExportProject', disabled: !Model.doc(), onclick: () => { Pop.close(); exportFile(); } }, h('span', { class: 'grow' }, 'Export', h('small', null, 'Download this project as a file'))));
    Pop.open(anchor, el);
  }

  function start() {
    $('projFile').addEventListener('change', onFile);
    $('emptyImport').addEventListener('click', pickFile);
    const id = ProjectMod.projectIdFromUrl(location);
    if (id && !TEST_MODE) { if (!open(id)) emit(); } else emit();
  }
  return { list, open, openDoc, close, importFile, exportFile, openMenu, listButtons, start, onChange: (fn) => listeners.push(fn), notice: () => note, hasStorage: () => !!storage };
})();
