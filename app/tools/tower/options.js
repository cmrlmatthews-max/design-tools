/* ==========================================================================
   TOWER: saved options, presets and the autosaved working copy
   Port of the Options glue in build/tower/09_storage.js. The storage module stays in src/shared/storage.js and the
   localStorage key stays 'towergen.options.v1', so options saved in the old Tower page open here.
   Not ported (Later): option JSON import and export.
   ========================================================================== */
import { createStorage, uniqueName } from '../../../src/shared/storage.js';
import { CONFIG, fillDefaults, defaultState, surroundBlocks, migrateTower } from './state.js';

const quoted = (name) => `“${name}”`;

export function createOptions(T) {
  const { ctx, store } = T;
  const { Toast } = ctx.ui;
  const storage = createStorage({
    key: CONFIG.storageKey, schema: CONFIG.schema, migrate: migrateTower,
    onNotice: (message) => Toast.show(message, { kind: 'warn', ms: 7000 }),
  });
  let currentId = null;             // the saved option the working copy came from (null = unsaved)
  let savedPrint = null;            // fingerprint of that option's state, to show "unsaved changes"
  let held = false;                 // tests hold the autosave
  const listeners = [];
  const fingerprint = (s) => JSON.stringify({ ...s, name: '', placement: null, view: null });
  const savedNames = () => storage.list().map((o) => o.name);
  const uniqueName0 = (name, extra = []) => uniqueName(name, [...savedNames(), ...extra]);
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  function link(id, state) {
    currentId = id || null;
    savedPrint = currentId ? fingerprint(state || store.raw()) : null;
    changed();
  }
  const dirty = () => !currentId || savedPrint !== fingerprint(store.raw());

  /** Puts a design on screen as the working copy. One undo step brings the previous design back. */
  function show(raw, { id = null, name } = {}) {
    const s = fillDefaults(raw);
    if (name) s.name = name;
    // in a project, a design with no placement of its own starts at the site center, on the ground there
    const place = T.project.hasDoc() && !(s.placement && typeof s.placement === 'object');
    if (place) T.project.prepareNew(s);
    store.replace(s);
    if (place) T.project.followGround({ merge: true });
    link(id, s);
    try { ctx.scene.frameBuilding(); } catch (e) { /* the view stays */ }
    return s;
  }

  function loadOption(id) {
    const rec = storage.get(id);
    if (!rec) { Toast.show('That option is no longer saved.', { kind: 'warn' }); return false; }
    show(rec.state, { id: rec.id, name: rec.name });
    Toast.show(`Opened ${quoted(rec.name)}. Undo brings your last design back.`);
    return true;
  }

  /** A preset becomes a new, unsaved option; its context is replaced by the Surround set for its site. */
  function loadPreset(id) {
    const p = CONFIG.presets.find((x) => x.id === id);
    if (!p) return false;
    const s = fillDefaults(p.state);
    const cur = store.raw().site;
    if (cur && cur.shape === 'none') { s.site.shape = 'none'; s.site.heightLimit = 0; }
    s.context.blocks = surroundBlocks(s);
    s.context.show = true;
    s.view.colorBy = 'program';
    show(s, { id: null, name: p.name });
    Toast.show(`Started from the preset ${quoted(p.name)}. It is not saved yet.`);
    return true;
  }

  function hasUnsavedChanges() {
    const rec = currentId && storage.get(currentId);
    return rec ? savedPrint !== fingerprint(store.raw()) : fingerprint(store.raw()) !== fingerprint(defaultState());
  }

  /** A fresh default design as a new, unsaved option. Resolves true when it happened. */
  async function newDesign({ confirm = true } = {}) {
    if (confirm && hasUnsavedChanges()) {
      const ok = await ctx.ui.confirmDialog({ title: 'Start a new design?', body: `Unsaved changes to ${quoted(store.get('name') || 'this design')} will be lost. You can undo this.`, ok: 'Start new', cancel: 'Cancel' });
      if (!ok) return false;
    }
    T.select.clear();
    const s = defaultState();
    s.name = uniqueName0('Untitled');
    T.project.prepareNew(s);
    store.replace(s);
    if (T.project.hasDoc()) T.project.followGround({ merge: true });
    link(null, s);
    try { ctx.scene.setView('axon', { animate: true }); } catch (e) { /* the view stays */ }
    Toast.show('New design started.');
    return true;
  }

  function save() {
    const state = store.snapshot();
    const known = currentId && storage.get(currentId);
    if (known) {
      storage.update(currentId, state, state.name);
      link(currentId, state);
      Toast.show(`Saved ${quoted(state.name)}`);
    } else {
      const name = uniqueName0(state.name);
      if (name !== state.name) store.set('name', name, { live: false });
      const id = storage.save(store.snapshot(), name);
      link(id);
      Toast.show(`Saved ${quoted(name)}`);
    }
    return currentId;
  }

  function duplicate() {
    const base = store.snapshot();
    const name = uniqueName0(base.name, [base.name]);
    store.set('name', name, { live: false });
    const id = storage.save(store.snapshot(), name);
    link(id);
    Toast.show(`Saved a copy as ${quoted(name)}`);
    return id;
  }

  function rename(next) {
    const name = String(next || '').trim().slice(0, 60) || 'Option A';
    store.set('name', name, { live: false });
    if (currentId && storage.get(currentId)) storage.rename(currentId, name);
    changed();
  }

  async function remove() {
    const rec = currentId && storage.get(currentId);
    if (!rec) { Toast.show('This option is not saved, so there is nothing to delete.', { kind: 'warn' }); return false; }
    const ok = await ctx.ui.confirmDialog({ title: 'Delete this option?', body: `${quoted(rec.name)} is removed from the saved options. The design on screen stays open.`, ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return false;
    storage.remove(rec.id);
    link(null);
    Toast.show(`Deleted ${quoted(rec.name)}. The design on screen is now unsaved.`);
    return true;
  }

  const when = (t) => { try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  /** Pop menu items: saved options and presets. */
  function menuItems() {
    const items = [
      { label: 'New design', hint: 'Default tower', action: () => { newDesign(); } },
      { sep: true },
      { label: 'Save', hint: 'Keep this design', action: () => save() },
      { label: 'Duplicate', hint: 'Save a copy', action: () => duplicate() },
      { label: 'Delete', hint: 'Remove the saved option', disabled: !currentId, action: () => { remove(); } },
      { sep: true },
    ];
    const saved = storage.list();
    if (!saved.length) items.push({ label: 'Nothing saved yet', disabled: true });
    for (const o of saved) items.push({ label: o.name, hint: `Saved ${when(o.updatedAt)}`, checked: o.id === currentId, action: () => loadOption(o.id) });
    items.push({ sep: true });
    for (const p of CONFIG.presets) items.push({ label: `Preset: ${p.name}`, action: () => loadPreset(p.id) });
    return items;
  }

  /** Brings back the autosaved working copy. Returns the state or null. */
  function restore() {
    let saved = null;
    try { saved = storage.loadAutosave(); } catch (e) { saved = null; }
    return saved ? fillDefaults(saved) : null;
  }
  let off = null;
  function watch() {
    if (off) return;
    off = store.subscribe((s) => { if (!held) { try { storage.autosave(s); } catch (e) { /* the notice already showed */ } } });
  }
  function dispose() { if (off) off(); off = null; try { storage.flush(); } catch (e) { /* ignore */ } }

  return {
    storage, save, duplicate, rename, remove, loadOption, loadPreset, newDesign, hasUnsavedChanges, menuItems, restore, watch, dispose,
    link, dirty, current: () => currentId, list: () => storage.list(), hold: (v) => { held = !!v; }, onChange: (fn) => listeners.push(fn),
  };
}
