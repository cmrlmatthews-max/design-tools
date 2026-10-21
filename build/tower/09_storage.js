/* ==========================================================================
   SHARED: storage
   src/shared/storage.js inlined unchanged (apart from the export keywords),
   plus `Options`, the tower tool's glue: save, duplicate, rename, delete, the
   option menu, export / import, autosave and restore.
   Custom AI prompts ride in the same blob (storage.listPrompts / savePrompt / removePrompt).
   Saved options live under localStorage key `towergen.options.v1`; the
   working copy autosaves into the "__current" slot after a 1 s pause.
   ========================================================================== */
//@@MODULE storage@@

const Options = (() => {
  const storage = StorageMod.createStorage({
    key: CONFIG.storageKey, schema: CONFIG.schema, migrate: (s) => s,
    onNotice: (message) => Toast.show(message, 'warn', 7000),
  });
  let currentId = null;            // the saved option the working copy came from (null = unsaved)
  let savedPrint = null;           // fingerprint of that option's state, to show "unsaved changes"
  let dirtyTimer = null;
  let autosaveHeld = false;       // tests hold the autosave so a ?test visit cannot overwrite the saved working copy

  const fingerprint = (s) => JSON.stringify({ ...s, name: '' });
  const savedNames = () => storage.list().map((o) => o.name);
  const quoted = (name) => `“${name}”`;

  function syncDirty() {
    clearTimeout(dirtyTimer);
    const dot = document.getElementById('unsavedDot');
    const dirty = !currentId || savedPrint !== fingerprint(Store.raw());
    if (dot) dot.hidden = !dirty;
    const btn = document.getElementById('btnSave');
    if (btn) btn.classList.toggle('is-on', dirty);
    return dirty;
  }
  function link(id, state) {
    currentId = id || null;
    uiPrefs.currentId = currentId;
    saveUiPrefs(uiPrefs);
    savedPrint = currentId ? fingerprint(state || Store.raw()) : null;
    syncDirty();
  }
  const reframe = () => { if (Render.ready()) Render.setView(Render.info().preset || 'axon', true); };

  /** Put a state on screen as the working copy. Undo brings the previous design back. */
  function show(raw, { id = null, name } = {}) {
    const s = fillDefaults(raw);
    if (name) s.name = name;
    if (Render.comparing()) Compare.exit();
    Store.replace(s);
    link(id, s);
    reframe();
    return s;
  }

  function loadOption(id) {
    const rec = storage.get(id);
    if (!rec) { Toast.show('That option is no longer saved.', 'warn'); return false; }
    show(rec.state, { id: rec.id, name: rec.name });
    Toast.show(`Opened ${quoted(rec.name)}. Undo brings your last design back.`);
    return true;
  }
  /** A preset becomes a new, unsaved option; its context is replaced by the Surround set for its site. */
  function loadPreset(id) {
    const p = CONFIG.presets.find((x) => x.id === id);
    if (!p) return false;
    const s = fillDefaults(p.state);
    s.context.blocks = surroundBlocks(s);
    s.context.show = true;
    s.view.colorBy = 'program';          // v1.1: a preset is a new option, and new options color the Diagram by program
    show(s, { id: null, name: p.name });
    Toast.show(`Started from the preset ${quoted(p.name)}. It is not saved yet.`);
    return true;
  }

  /** Unsaved changes = a design linked to a saved option that no longer matches it, or an unsaved design that differs from the default
   *  (an untouched new design has nothing to lose). The name is ignored, as in the dot next to Save. */
  function hasUnsavedChanges() {
    const rec = currentId && storage.get(currentId);
    return rec ? savedPrint !== fingerprint(Store.raw()) : fingerprint(Store.raw()) !== fingerprint(defaultState());
  }
  /** Start fresh from the built-in default (what a first-ever visit gets) as a new, unsaved option named "Untitled" ("Untitled (2)"
   *  when taken). Saved options are never touched. One undo step brings the previous design back (its name is part of the state;
   *  like loadPreset, the link to a saved option is not restored). Resolves true when it happened, false when the user cancelled. */
  async function newDesign({ confirm = true } = {}) {
    if (confirm && hasUnsavedChanges()) {
      const ok = await confirmDialog(`Start a new design? Unsaved changes to ${quoted(Store.get('name') || 'this design')} will be lost. You can undo this.`, 'Start new');
      if (!ok) return false;
    }
    Select.cancelHandleDrag();
    Select.clear();
    Prompts.close();
    if (Render.comparing()) Compare.exit();
    const s = defaultState();
    s.name = uniqueName0('Untitled');
    Store.replace(s);
    link(null, s);
    if (Render.ready()) Render.setView('axon', true);       // always Axon, whatever view was on screen
    Toast.show('New design started.');
    return true;
  }

  function save() {
    const state = Store.snapshot();
    const known = currentId && storage.get(currentId);
    if (known) {
      storage.update(currentId, state, state.name);
      link(currentId, state);
      Toast.show(`Saved ${quoted(state.name)}`);
    } else {
      const name = uniqueName0(state.name);
      if (name !== state.name) Store.set('name', name, { live: false });
      const id = storage.save(Store.snapshot(), name);
      link(id);
      Toast.show(`Saved ${quoted(name)}`);
    }
    return currentId;
  }
  const uniqueName0 = (name, extra = []) => StorageMod.uniqueName(name, [...savedNames(), ...extra]);

  function duplicate() {
    const base = Store.snapshot();
    const name = uniqueName0(base.name, [base.name]);
    Store.set('name', name, { live: false });
    const id = storage.save(Store.snapshot(), name);
    link(id);
    Toast.show(`Saved a copy as ${quoted(name)}`);
    return id;
  }

  function rename(next) {
    const name = String(next || '').trim().slice(0, 60) || 'Option A';
    Store.set('name', name, { live: false });
    if (currentId && storage.get(currentId)) storage.rename(currentId, name);
    const field = document.getElementById('optionName');
    if (field) field.value = Store.get('name');
    syncDirty();
  }

  async function remove() {
    const rec = currentId && storage.get(currentId);
    if (!rec) { Toast.show('This option is not saved, so there is nothing to delete.', 'warn'); return false; }
    const ok = await confirmDialog(`Delete ${quoted(rec.name)} from the saved options? The design on screen stays open.`, 'Delete', true);
    if (!ok) return false;
    storage.remove(rec.id);
    link(null);
    Toast.show(`Deleted ${quoted(rec.name)}. The design on screen is now unsaved.`);
    return true;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const importListeners = [];
  function exportJson() {
    const n = storage.list().length, np = storage.listPrompts().length;
    if (!n && !np) { Toast.show('Nothing to export yet. Save an option first.', 'warn'); return false; }
    storage.downloadExport();
    Toast.show(`Exported ${[n ? plural(n, 'option') : '', np ? plural(np, 'custom prompt') : ''].filter(Boolean).join(' and ')}`);
    return true;
  }
  async function importFile(file) {
    try {
      const { added, skipped, promptsAdded } = await storage.importFile(file);
      const parts = [added || !promptsAdded ? plural(added, 'option') : '', promptsAdded ? plural(promptsAdded, 'custom prompt') : ''].filter(Boolean);
      Toast.show(`Imported ${parts.join(' and ')}${skipped ? `, ${skipped} skipped` : ''}.${added ? ' Open the options from the Option menu.' : ''}`);
      importListeners.forEach((fn) => fn({ added, skipped, promptsAdded }));
      return { added, skipped, promptsAdded };
    } catch (e) {
      Toast.show(e && e.message ? e.message : 'The file could not be imported.', 'bad', 7000);
      return { added: 0, skipped: 0, error: String(e && e.message) };
    }
  }

  const when = (t) => { try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  function openMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'optionMenu' });
    const item = (title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id: o.id, disabled: o.disabled, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'tick' }, o.tick ? '✓' : ''), h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null));

    // The option name is edited here. It is committed when the field changes or the menu closes.
    const nameField = h('input', { class: 'pop-name', id: 'optionName', type: 'text', maxlength: '60', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Option name', value: Store.get('name') || '' });
    const commitName = () => { if (nameField.value.trim() !== (Store.get('name') || '')) rename(nameField.value); };
    nameField.addEventListener('change', commitName);
    nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitName(); Pop.close(); } });
    el.append(
      item('New design', 'Start fresh from the default tower', () => { newDesign(); }, { id: 'miNewDesign' }),
      h('div', { class: 'pop-sep' }),
    );
    el.append(h('div', { class: 'label pop-label' }, 'Option name'), h('div', { style: 'padding:0 6px 4px' }, nameField));

    el.append(h('div', { class: 'label pop-label' }, 'This option'));
    el.append(
      item('Save', 'Keep the design as it is now', save, { id: 'miSave' }),
      item('Duplicate', 'Save a copy as a new option', duplicate, { id: 'miDuplicate' }),
      item('Rename', 'Edit the name above', () => { nameField.focus(); nameField.select(); }, { id: 'miRename', keep: true }),
      item('Delete', 'Remove it from the saved options', remove, { id: 'miDelete', disabled: !currentId }),
      item(Compare.isActive() ? 'Exit compare' : 'Compare', 'Compare 2 to 4 options side by side', () => Compare.toggle(), { id: 'miCompare' }),
    );
    el.append(h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Saved options'));
    const saved = storage.list();
    if (!saved.length) el.append(h('div', { class: 'pop-note' }, 'Nothing saved yet. Use Save to keep this design.'));
    for (const o of saved) el.append(item(o.name, `Saved ${when(o.updatedAt)}`, () => loadOption(o.id), { tick: o.id === currentId }));
    el.append(h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'New from a preset'));
    for (const p of CONFIG.presets) el.append(item(p.name, p.description, () => loadPreset(p.id), { id: `preset-${p.id}` }));
    Pop.open(anchor, el, { onClose: commitName });
  }

  function init({ restore = true } = {}) {
    if (restore) {
      const saved = storage.loadAutosave();
      if (saved) {
        const s = fillDefaults(saved);
        Store.replace(s, { resetHistory: true });
        const rec = uiPrefs.currentId && storage.get(uiPrefs.currentId);
        if (rec) link(rec.id, fillDefaults(rec.state)); else link(null);
      } else link(null);
    } else link(null);
    Store.subscribe((s, info) => {
      if (!autosaveHeld) storage.autosave(s);
      if (!info || !info.live) { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(syncDirty, 250); }
    });
    const input = document.getElementById('importFile');
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (file) await importFile(file);
    });
  }

  return {
    onImport: (fn) => importListeners.push(fn),
    holdAutosave: (v) => { autosaveHeld = !!v; },
    init, save, duplicate, rename, remove, openMenu, loadOption, loadPreset, newDesign, hasUnsavedChanges, exportJson, importFile, syncDirty,
    list: () => storage.list(), get: (id) => storage.get(id), flush: () => storage.flush(),
    current: () => currentId, storage,
  };
})();
