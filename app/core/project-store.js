/* ==========================================================================
   CORE: project store (app/CONTRACT.md section 3; docs/project-file-spec.md sections 5 and 8)
   One in-memory project for the page. Every read and write goes through
   src/shared/project.js, so the ownership rules of the spec stay in one place.

   Writes
   - write(key, patch) runs writeSection on the open project (ensure() first),
     emits section:<key> and project:change (source 'local'), and saves after
     `debounceMs` (1 s). Each key keeps one merged patch until the save.
   - flush() saves now. It re-reads the stored copy first and writes the pending
     patches on THAT copy. So the stored copy of every other section is kept: a
     newer section from another page (the Plate Planner, a second tab) is never
     overwritten. Sections that came in this way are announced (source 'storage').
   - A section with a schema newer than 1 (or a project from a newer version) is
     read-only. write() on it shows a notice and does nothing.

   Reads from other pages
   - reload() re-reads the stored copy and emits section:<key> only for sections
     whose updatedAt changed (source 'storage'). Pending local sections stay.
   - Wiring: visibilitychange (hidden: flush; visible: reload), pagehide (flush),
     pageshow from the back-forward cache (reload), focus (reload), and the
     storage event on cmrlm.project.<id> (reload).

   Startup: ?project=<id> from the address, else cmrlm.project.last, else nothing.

   Every window, document and storage access is guarded, so this module also
   imports in Node. Tests pass { storage, bus, debounceMs, win, timers }.
   ========================================================================== */

import {
  VERSION, SECTIONS, newProject, getSection, writeSection, listProjects, loadProject,
  saveProject, exportProject, importProject, projectIdFromUrl,
} from '../../src/shared/project.js';
import { bus as sharedBus } from './bus.js';

const KEY_LAST = 'cmrlm.project.last';
const KEY_PREFIX = 'cmrlm.project.';
const APP_SCHEMA = 1;                  // the section schema this app knows
const DEFAULT_NAME = 'Untitled project';
const READ_ONLY_TEXT = 'This project was saved by a newer version of this tool. You can view it, but changes will not be saved.';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const stampOf = (s) => (s && typeof s.updatedAt === 'string' ? s.updatedAt : null);

/** window.localStorage, or null when the browser blocks it (project.js then shows its notice). */
export function safeLocalStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) { /* blocked site data */ }
  return null;
}

function defaultWin() {
  try { return typeof window !== 'undefined' ? window : null; } catch (e) { return null; }
}

/** Merges a later patch into an earlier one: the later fields win, placement merges key by key. */
function mergePatch(a, b) {
  const out = { ...(a || {}) };
  for (const k of Object.keys(b || {})) {
    if (k === 'placement' && isObj(out.placement) && isObj(b.placement)) out.placement = { ...out.placement, ...clone(b.placement) };
    else out[k] = clone(b[k]);
  }
  return out;
}

export function createProjectStore({
  storage = safeLocalStorage(),
  bus = sharedBus,
  debounceMs = 1000,
  win = defaultWin(),
  timers = null,
  autoStart = true,
} = {}) {
  const setT = (timers && timers.setTimeout) || ((fn, ms) => setTimeout(fn, ms));
  const clearT = (timers && timers.clearTimeout) || ((h) => clearTimeout(h));

  let doc = null;
  let pending = new Map();             // key -> merged patch not saved yet
  let timer = null;
  const blocked = new Set();           // keys that threw readOnly on write
  const told = new Set();              // notice texts already shown
  const offs = [];                     // event listeners to remove on dispose()

  /* ---- notices and events ---- */
  function notice(text, kind = 'warn', { once = true } = {}) {
    const t = String(text || '');
    if (!t) return;
    if (once) { if (told.has(t)) return; told.add(t); }
    bus.emit('notice', { text: t, kind });
  }
  const opts = { onNotice: (m) => notice(m, 'warn') };

  function emitChange(keys, source, toolOf) {
    if (!keys.length) return;
    const tools = new Set();
    for (const key of keys) {
      const section = getSection(doc, key);
      const tool = toolOf(key, section);
      tools.add(tool);
      bus.emit(`section:${key}`, { doc, section, source, tool });
    }
    const tool = tools.size === 1 ? [...tools][0] : null;
    bus.emit('project:change', { doc, keys: keys.slice(), source, tool });
  }
  const storedTool = (key, section) => (section && typeof section.tool === 'string' ? section.tool : null);

  /* ---- small storage helpers (every call guarded) ---- */
  function setLast(id) {
    try { (storage || globalThis.localStorage).setItem(KEY_LAST, id); } catch (e) { /* project.js notices storage failures */ }
  }
  function getLast() {
    try { return (storage || globalThis.localStorage).getItem(KEY_LAST); } catch (e) { return null; }
  }
  function clearLast(id) {
    try {
      const s = storage || globalThis.localStorage;
      if (s.getItem(KEY_LAST) === id) s.removeItem(KEY_LAST);
    } catch (e) { /* ignore */ }
  }
  function load(id) {
    try { return loadProject(storage, id, opts); } catch (e) { return null; }
  }

  /** Puts ?project=<id> in the address (or removes it), keeping the other parameters. */
  function updateUrl(id) {
    try {
      if (!win || !win.history || typeof win.history.replaceState !== 'function' || !win.location) return;
      const url = new URL(win.location.href);
      if (id) url.searchParams.set('project', id); else url.searchParams.delete('project');
      win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) { /* the address stays as it is */ }
  }

  /* ---- reads ---- */
  const current = () => doc;
  const id = () => (doc ? doc.id : null);
  function list() {
    try { return listProjects(storage, opts); } catch (e) { return []; }
  }
  function section(key) { return doc ? getSection(doc, key) : null; }

  function isReadOnly(key) {
    if (!doc) return false;
    if (Number.isFinite(doc.version) && doc.version > VERSION) return true;
    if (blocked.has(key)) return true;
    const s = getSection(doc, key);
    return !!s && Number.isFinite(s.schema) && s.schema > APP_SCHEMA;
  }

  /* ---- open, create, close ---- */
  function show(next, { url = true } = {}) {
    doc = next;
    pending = new Map();
    blocked.clear();
    clearT(timer); timer = null;
    if (doc) setLast(doc.id);
    if (url) updateUrl(doc ? doc.id : null);
    bus.emit('project:open', { doc });
    return doc;
  }

  /** Opens a saved project. Returns the doc, or null (with a notice) when it cannot be opened. */
  function open(pid, { quiet = false, url = true } = {}) {
    if (doc && doc.id === pid) { reload(); return doc; }
    flush();
    const next = load(pid);
    if (!next) {
      if (!quiet) notice('This project could not be opened.', 'bad', { once: false });
      return null;
    }
    return show(next, { url });
  }

  /** A new local project, saved and opened. The name is trimmed; an empty name becomes "Untitled project". */
  function create(name) {
    flush();
    const title = String(name == null ? '' : name).trim().slice(0, 80) || DEFAULT_NAME;
    let next;
    try { next = newProject({ name: title }); } catch (e) {
      notice(`The project could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', { once: false });
      return null;
    }
    save(next);
    return show(next);
  }

  function close() {
    flush();
    if (!doc) return;
    clearLast(doc.id);
    show(null);
  }

  function ensure() {
    return doc || create(DEFAULT_NAME);
  }

  /* ---- write and save ---- */
  function save(next) {
    let res = null;
    try { res = saveProject(storage, next, opts); } catch (e) { res = null; }
    if (!res || res.ok === false) {
      notice((res && res.warning) || 'The project could not be saved.', 'bad');
      return false;
    }
    if (res.warning) notice(res.warning, 'warn');
    return true;
  }

  function schedule() {
    clearT(timer);
    timer = null;
    if (!(debounceMs >= 0)) return;    // a negative or missing delay: save only on flush()
    timer = setT(() => { timer = null; flush(); }, debounceMs);
  }

  /**
   * Writes one section of the open project (a project is made first when none is open).
   * Returns the new doc, or null when the section is read-only or the patch is not valid.
   */
  function write(key, patch) {
    if (!SECTIONS.includes(key)) {
      notice(`Unknown project section "${key}".`, 'bad');
      return null;
    }
    const base = ensure();
    if (!base) return null;
    if (isReadOnly(key)) { notice(READ_ONLY_TEXT, 'warn'); return null; }
    const p = isObj(patch) ? patch : {};
    let next;
    try { next = writeSection(base, key, p); } catch (e) {
      if (e && e.readOnly) { blocked.add(key); notice(e.message || READ_ONLY_TEXT, 'warn'); return null; }
      notice(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad', { once: false });
      return null;
    }
    doc = next;
    pending.set(key, mergePatch(pending.get(key), p));
    schedule();
    emitChange([key], 'local', (k, s) => (typeof p.tool === 'string' && p.tool ? p.tool : storedTool(k, s)));
    return doc;
  }

  /**
   * Saves now (spec section 8, Conflicts). Re-reads the stored copy and writes the pending patches on it, so every
   * other section keeps its stored copy. Sections that changed in storage are announced (source 'storage').
   * Returns { ok, skipped?, merged? }.
   */
  function flush() {
    clearT(timer);
    timer = null;
    if (!doc || !pending.size) return { ok: true, skipped: true };
    const stored = load(doc.id);
    let next = stored || doc;
    const before = doc;
    for (const [key, patch] of pending) {
      const s = getSection(next, key);
      if (s && Number.isFinite(s.schema) && s.schema > APP_SCHEMA) {
        // a newer tool saved this section meanwhile: never write over it
        blocked.add(key); notice(READ_ONLY_TEXT, 'warn'); pending.delete(key);
        continue;
      }
      try { next = writeSection(next, key, patch); } catch (e) {
        if (e && e.readOnly) { blocked.add(key); notice(e.message || READ_ONLY_TEXT, 'warn'); } else notice(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), 'bad');
        pending.delete(key);
      }
    }
    if (!pending.size) return { ok: false };
    const written = [...pending.keys()];
    const ok = save(next);
    if (!ok) return { ok: false };
    doc = next;
    pending = new Map();
    // sections another page saved meanwhile now show here
    const changed = changedKeys(before, next).filter((k) => !written.includes(k));
    emitChange(changed, 'storage', storedTool);
    return { ok: true, merged: changed.length > 0 };
  }

  /** Section keys whose updatedAt (or presence) differs between two docs. */
  function changedKeys(a, b) {
    const keys = new Set([...Object.keys((a && a.sections) || {}), ...Object.keys((b && b.sections) || {})]);
    return [...keys].filter((k) => SECTIONS.includes(k) && stampOf(getSection(a, k)) !== stampOf(getSection(b, k)));
  }

  /**
   * Re-reads the open project from storage. Emits section:<key> only for sections whose updatedAt changed.
   * Local sections not saved yet stay as they are in memory. Returns the changed keys.
   */
  function reload() {
    if (!doc) return [];
    const fresh = load(doc.id);
    if (!fresh) return [];
    let next = fresh;
    if (pending.size) {
      next = clone(fresh);
      if (!isObj(next.sections)) next.sections = {};
      for (const key of pending.keys()) {
        const mine = getSection(doc, key);
        if (mine) next.sections[key] = clone(mine);
      }
    }
    const keys = changedKeys(doc, next).filter((k) => !pending.has(k));
    doc = next;
    emitChange(keys, 'storage', storedTool);
    return keys;
  }

  /* ---- files ---- */
  async function importFile(file) {
    flush();
    try {
      const res = await importProject(file, storage, opts);
      const next = res && res.doc;
      if (!next) throw new Error('The file could not be read.');
      show(next);
      notice(res.renamed ? `Imported as ${next.name}.` : `Imported ${next.name}.`, 'info', { once: false });
      if (res.warning) notice(res.warning, 'warn');
      return next;
    } catch (e) {
      notice(e && e.message ? e.message : 'The file could not be imported.', 'bad', { once: false });
      return null;
    }
  }

  /** Saves, then downloads the open project as <name>.cmrlm.json (the share sheet on iPad). Resolves the file name or null. */
  async function exportCurrent() {
    if (!doc) return null;
    flush();
    try {
      const out = exportProject(doc);
      if (out.blob && win && win.document && typeof win.document.createElement === 'function') {
        const { deliverImage } = await import('../../src/shared/screenshot.js');
        const how = await deliverImage(out.blob, out.filename);
        if (how === 'downloaded') notice(`Saved ${out.filename}`, 'info', { once: false });
      }
      return out.filename;
    } catch (e) {
      notice(`The project file could not be made. ${e && e.message ? e.message : ''}`.trim(), 'bad', { once: false });
      return null;
    }
  }

  /* ---- wiring ---- */
  function listen(target, evt, fn) {
    try {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(evt, fn);
      offs.push(() => { try { target.removeEventListener(evt, fn); } catch (e) { /* ignore */ } });
    } catch (e) { /* no events here */ }
  }
  const safe = (fn) => (ev) => { try { fn(ev); } catch (e) { try { console.error(e); } catch (e2) { /* no console */ } } };

  if (win) {
    const docEl = (() => { try { return win.document || null; } catch (e) { return null; } })();
    listen(docEl, 'visibilitychange', safe(() => {
      let state = 'visible';
      try { state = docEl.visibilityState; } catch (e) { /* keep visible */ }
      if (state === 'hidden') flush(); else reload();
    }));
    listen(win, 'pagehide', safe(() => flush()));
    listen(win, 'pageshow', safe((e) => { if (e && e.persisted) reload(); }));
    listen(win, 'focus', safe(() => reload()));
    listen(win, 'storage', safe((e) => {
      if (!doc) return;
      const key = e ? e.key : null;
      if (key === null || key === undefined || key === KEY_PREFIX + doc.id) reload();
    }));
  }

  /* ---- startup ---- */
  if (autoStart) {
    let fromUrl = null;
    try { fromUrl = win && win.location ? projectIdFromUrl(win.location) : null; } catch (e) { fromUrl = null; }
    let opened = null;
    if (fromUrl) opened = open(fromUrl, { url: false });
    if (!opened) {
      const last = getLast();
      if (last && last !== fromUrl) opened = open(last, { quiet: true, url: !!fromUrl });
    }
  }

  return {
    doc: current, id, list, open, create, close, ensure, section, write, flush, reload,
    importFile, exportCurrent, isReadOnly,
    // tests and teardown
    pending: () => [...pending.keys()],
    dispose: () => { clearT(timer); timer = null; offs.splice(0).forEach((f) => f()); },
  };
}
