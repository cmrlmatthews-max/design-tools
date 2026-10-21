/* ==========================================================================
   SHARED: storage
   Save, load, export and import of design "options" in localStorage.

   One localStorage key holds:
     { schema, options: [{ id, name, createdAt, updatedAt, state }], current }
   where `current` is the autosave slot: { state, updatedAt } (slot "__current").
   An optional `prompts: [{ id, title, template, ... }]` list (custom AI prompts) rides in the same blob; it is
   omitted while empty, travels in export / import, and import renames title collisions "Title (2)".

   Rules
   - Every storage access is inside try/catch. On any failure onNotice(message)
     is called ONCE (per storage instance) and the data stays in memory, so the
     tool keeps working for the rest of the session.
   - `migrate(state, fromSchema)` runs whenever a state with state.schema <
     `schema` is loaded or imported. It must return the migrated state.
   - Pure ES module. No DOM access except export download / visibility flush,
     both guarded.
   ========================================================================== */

const AUTOSAVE_MS = 1000;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/* ---------- small helpers ---------- */

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function newId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function pad2(n) { return String(n).padStart(2, "0"); }

/** `towergen-options-YYYY-MM-DD.json` (local date). */
export function exportFilename(date = new Date(), prefix = "towergen-options") {
  const d = date instanceof Date ? date : new Date(date);
  return `${prefix}-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
}

/** "Name" → "Name (2)", "Name (3)" … first one not in `taken` (case-insensitive). */
export function uniqueName(name, taken) {
  const lower = new Set([...taken].map((n) => String(n).trim().toLowerCase()));
  const base = String(name || "").trim() || "Untitled";
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100000; n++) {
    const candidate = `${base} (${n})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${newId()})`;
}

/* ---------- factory ---------- */

/**
 * @param {object}   cfg
 * @param {string}   cfg.key       localStorage key, e.g. "towergen.options.v1"
 * @param {number}   cfg.schema    current state schema number
 * @param {Function} [cfg.migrate] (state, fromSchema) => state
 * @param {Function} [cfg.onNotice] (message) => void, called at most once
 * @param {number}   [cfg.debounceMs=1000]  autosave delay
 * @param {string}   [cfg.filePrefix="towergen-options"]  export filename prefix
 * @param {object}   [cfg.storage]  Storage-like object (tests); default window.localStorage
 */
export function createStorage({
  key,
  schema,
  migrate,
  onNotice,
  debounceMs = AUTOSAVE_MS,
  filePrefix = "towergen-options",
  storage,
} = {}) {
  if (!key) throw new Error("createStorage: `key` is required");
  if (!Number.isFinite(schema)) throw new Error("createStorage: `schema` must be a number");

  let noticed = false;
  let persistent = true;     // false once any read/write failed
  let readOnly = false;      // data written by a newer app version: never overwrite
  let lastRaw = null;        // last string we know is in storage
  let data = { schema, options: [], current: null, prompts: [] };
  let timer = null;
  let pendingAutosave = null;

  function notice(message) {
    persistent = false;
    if (noticed) return;
    noticed = true;
    try { if (typeof onNotice === "function") onNotice(message); } catch (e) { /* ignore */ }
  }

  function backend() {
    // Accessing window.localStorage itself can throw (blocked site data).
    return storage || globalThis.localStorage;
  }

  /* ----- migration ----- */

  function migrateState(state, fromSchema) {
    if (!isObj(state)) return state;
    const from = Number.isFinite(state.schema) ? state.schema : fromSchema;
    if (!Number.isFinite(from) || from >= schema) {
      if (!Number.isFinite(state.schema)) state.schema = schema;
      return state;
    }
    let out = state;
    try {
      out = typeof migrate === "function" ? migrate(clone(state), from) : state;
      if (!isObj(out)) out = state;
    } catch (e) {
      notice("Some saved options are from an older version and could not be updated.");
      return state;
    }
    out.schema = schema;
    return out;
  }

  /* ----- parse / validate stored blob ----- */

  function normalizeRecord(r, fallbackSchema) {
    if (!isObj(r) || !isObj(r.state)) return null;
    const now = Date.now();
    const num = (v) => (Number.isFinite(v) ? v : now);
    return {
      id: typeof r.id === "string" && r.id ? r.id : newId(),
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Untitled",
      createdAt: num(r.createdAt),
      updatedAt: num(r.updatedAt),
      state: migrateState(clone(r.state), fallbackSchema),
    };
  }

  /** A custom prompt record (any extra fields are kept), or null when it has no usable title and template. */
  function normalizePrompt(p) {
    if (!isObj(p) || typeof p.title !== "string" || !p.title.trim() || typeof p.template !== "string") return null;
    const now = Date.now();
    const num = (v) => (Number.isFinite(v) ? v : now);
    return {
      ...clone(p),
      id: typeof p.id === "string" && p.id ? p.id : newId(),
      title: p.title.trim(),
      group: "custom",
      template: p.template,
      uses: Array.isArray(p.uses) ? p.uses.filter((u) => typeof u === "string") : [],
      createdAt: num(p.createdAt),
      updatedAt: num(p.updatedAt),
    };
  }

  /** @returns {object|null} normalized data, or null when raw is unusable. */
  function parseBlob(raw) {
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return null; }
    if (!isObj(obj) || !Array.isArray(obj.options) || !Number.isFinite(obj.schema)) return null;
    const out = { schema, options: [], current: null, prompts: [], newer: obj.schema > schema };
    const seen = new Set();
    for (const r of obj.options) {
      const rec = normalizeRecord(r, obj.schema);
      if (!rec) continue;
      if (seen.has(rec.id)) rec.id = newId();
      seen.add(rec.id);
      out.options.push(rec);
    }
    if (Array.isArray(obj.prompts)) {
      const ids = new Set();
      for (const p of obj.prompts) {
        const rec = normalizePrompt(p);
        if (!rec) continue;
        if (ids.has(rec.id)) rec.id = newId();
        ids.add(rec.id);
        out.prompts.push(rec);
      }
    }
    if (isObj(obj.current) && isObj(obj.current.state)) {
      out.current = {
        state: migrateState(clone(obj.current.state), obj.schema),
        updatedAt: Number.isFinite(obj.current.updatedAt) ? obj.current.updatedAt : Date.now(),
      };
    }
    return out;
  }

  /** Read storage into memory. `initial` = first load (corrupt value is replaced). */
  function load(initial) {
    let raw;
    try {
      raw = backend().getItem(key);
    } catch (e) {
      notice("Saving is unavailable in this browser, so options will only be kept until you close this page.");
      return;
    }
    if (raw === lastRaw && !initial) return;       // nothing changed since we last looked
    if (raw === null || raw === undefined) {
      lastRaw = null;
      return;
    }
    const parsed = parseBlob(raw);
    if (!parsed) {
      lastRaw = raw;
      notice("Saved options could not be read and were reset. A backup copy of the old data was kept.");
      if (initial) {
        data = { schema, options: [], current: null, prompts: [] };
        try { backend().setItem(key + ".corrupt", raw); } catch (e) { /* ignore */ }
      }
      // Not initial: keep the good in-memory copy; the next write overwrites the bad value.
      return;
    }
    if (parsed.newer) {
      readOnly = true;
      notice("Saved options were made by a newer version of this tool. They can be viewed but changes will not be saved.");
    }
    delete parsed.newer;
    data = parsed;
    lastRaw = raw;
  }

  function persist() {
    if (readOnly) return false;
    let raw;
    try {
      const blob = { schema, options: data.options, current: data.current };
      if (data.prompts.length) blob.prompts = data.prompts;
      raw = JSON.stringify(blob);
    } catch (e) {
      notice("Options could not be saved.");
      return false;
    }
    try {
      backend().setItem(key, raw);
      lastRaw = raw;
      return true;
    } catch (e) {
      notice("Saving is unavailable in this browser (storage is blocked or full). Options will only be kept until you close this page.");
      return false;
    }
  }

  load(true);

  /* ----- records ----- */

  function find(id) { return data.options.find((o) => o.id === id); }
  function names(except) { return data.options.filter((o) => o !== except).map((o) => o.name); }
  function out(rec) { return rec ? clone(rec) : null; }
  function stamp(state) {
    const s = clone(state);
    if (isObj(s) && !Number.isFinite(s.schema)) s.schema = schema;
    return s;
  }

  const api = {
    /** All saved options, most recently updated first: [{id,name,createdAt,updatedAt,state}] (copies). */
    list() {
      load(false);
      return data.options.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(out);
    },

    get(id) {
      load(false);
      return out(find(id));
    },

    /** Saves a new option; returns its id. Name is kept as given (not renamed). */
    save(state, name) {
      load(false);
      const now = Date.now();
      const rec = {
        id: newId(),
        name: String(name || "").trim() || "Untitled",
        createdAt: now,
        updatedAt: now,
        state: stamp(state),
      };
      data.options.push(rec);
      persist();
      return rec.id;
    },

    /** Replaces the state of an existing option (optionally renames). Returns true if found. */
    update(id, state, name) {
      load(false);
      const rec = find(id);
      if (!rec) return false;
      rec.state = stamp(state);
      if (typeof name === "string" && name.trim()) rec.name = name.trim();
      rec.updatedAt = Date.now();
      persist();
      return true;
    },

    rename(id, name) {
      load(false);
      const rec = find(id);
      if (!rec || !String(name || "").trim()) return false;
      rec.name = String(name).trim();
      rec.updatedAt = Date.now();
      persist();
      return true;
    },

    remove(id) {
      load(false);
      const i = data.options.findIndex((o) => o.id === id);
      if (i < 0) return false;
      data.options.splice(i, 1);
      persist();
      return true;
    },

    /** Copies an option; newName defaults to "Name (2)" style. Returns the new id or null. */
    duplicate(id, newName) {
      load(false);
      const src = find(id);
      if (!src) return null;
      const now = Date.now();
      const rec = {
        id: newId(),
        name: uniqueName(String(newName || "").trim() || src.name, names()),
        createdAt: now,
        updatedAt: now,
        state: clone(src.state),
      };
      data.options.push(rec);
      persist();
      return rec.id;
    },

    /** Custom prompts, oldest first (copies). */
    listPrompts() {
      load(false);
      return data.prompts.map(clone);
    },

    /** Adds a custom prompt, or replaces the one with the same id. Returns the saved copy, or null when it has no title / template. */
    savePrompt(prompt) {
      load(false);
      const old = isObj(prompt) ? data.prompts.find((p) => p.id === prompt.id) : null;
      const rec = normalizePrompt({ ...prompt, updatedAt: Date.now(), createdAt: old ? old.createdAt : Date.now() });
      if (!rec) return null;
      if (old) data.prompts[data.prompts.indexOf(old)] = rec; else data.prompts.push(rec);
      persist();
      return clone(rec);
    },

    removePrompt(id) {
      load(false);
      const i = data.prompts.findIndex((p) => p.id === id);
      if (i < 0) return false;
      data.prompts.splice(i, 1);
      persist();
      return true;
    },

    /** Debounced (1 s) save of the working state into the "__current" slot. */
    autosave(state) {
      try { pendingAutosave = stamp(state); } catch (e) { notice("Options could not be saved."); return; }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(api.flush, debounceMs);
    },

    /** Writes any pending autosave immediately. */
    flush() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (pendingAutosave === null) return;
      load(false);
      data.current = { state: pendingAutosave, updatedAt: Date.now() };
      pendingAutosave = null;
      persist();
    },

    /** The autosaved working state (migrated copy), or null. A not-yet-flushed autosave counts. */
    loadAutosave() {
      if (pendingAutosave !== null) return clone(pendingAutosave);
      load(false);
      return data.current ? clone(data.current.state) : null;
    },

    /** All saved options (and custom prompts, when there are any) as an application/json Blob. */
    exportAll() {
      load(false);
      const payload = {
        schema,
        exportedAt: new Date().toISOString(),
        options: data.options.map(out),
      };
      if (data.prompts.length) payload.prompts = data.prompts.map(clone);
      return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    },

    /** `towergen-options-YYYY-MM-DD.json` */
    exportFilename(date) { return exportFilename(date, filePrefix); },

    /** Browser only: triggers a download of exportAll(). */
    downloadExport() {
      const blob = api.exportAll();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = api.exportFilename();
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },

    /**
     * Appends the options of an exportAll() file. Never replaces existing options.
     * Custom prompts in the file are appended too (a title already in use becomes "Title (2)").
     * Resolves {added, skipped, promptsAdded}; rejects with an Error whose message is shown to the user.
     */
    async importFile(file) {
      if (!file) throw new Error("No file was chosen.");
      if (typeof file.size === "number" && file.size > MAX_IMPORT_BYTES) {
        throw new Error("That file is too large to be an options file.");
      }
      let text;
      try {
        text = typeof file.text === "function" ? await file.text() : await readWithReader(file);
      } catch (e) {
        throw new Error("The file could not be read.");
      }
      let obj;
      try { obj = JSON.parse(text); } catch (e) {
        throw new Error("This file is not valid JSON, so it is not an options file.");
      }
      if (!isObj(obj) || !Array.isArray(obj.options)) {
        throw new Error("This file does not look like an exported options file (no options list found).");
      }
      if (!Number.isFinite(obj.schema)) {
        throw new Error("This file does not look like an exported options file (no schema number).");
      }
      if (obj.schema > schema) {
        throw new Error("This file was made by a newer version of the tool. Update the tool and try again.");
      }

      load(false);
      const taken = new Set(names());
      const incoming = [];
      let skipped = 0;
      for (const r of obj.options) {
        if (!isObj(r) || !isObj(r.state)) { skipped++; continue; }
        const rec = normalizeRecord({ ...r, id: undefined }, obj.schema);   // always a fresh id
        if (!rec) { skipped++; continue; }
        rec.name = uniqueName(rec.name, taken);
        taken.add(rec.name);
        incoming.push(rec);
      }
      const takenTitles = new Set(data.prompts.map((p) => p.title));
      const incomingPrompts = [];
      if (Array.isArray(obj.prompts)) {
        for (const p of obj.prompts) {
          const rec = normalizePrompt({ ...(isObj(p) ? p : {}), id: undefined });
          if (!rec) continue;
          rec.title = uniqueName(rec.title, takenTitles);
          takenTitles.add(rec.title);
          incomingPrompts.push(rec);
        }
      }
      if (incoming.length === 0 && incomingPrompts.length === 0 && obj.options.length > 0) {
        throw new Error("None of the options in this file could be used.");
      }
      data.options.push(...incoming);
      data.prompts.push(...incomingPrompts);
      if (incoming.length || incomingPrompts.length) persist();
      const res = { added: incoming.length, skipped };
      if (incomingPrompts.length) res.promptsAdded = incomingPrompts.length;
      return res;
    },

    /** True while saving to browser storage works (false after a failure; data is then memory-only). */
    isPersistent() { return persistent; },

    /** Stops timers and listeners (tests). Pending autosave is flushed first. */
    dispose() {
      api.flush();
      if (removeListener) removeListener();
    },
  };

  /* Flush a pending autosave when the page is hidden (iPad Safari can kill background tabs). */
  let removeListener = null;
  try {
    if (typeof document !== "undefined" && document.addEventListener) {
      const onHide = () => { if (document.visibilityState === "hidden") api.flush(); };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", api.flush);
      removeListener = () => {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", api.flush);
      };
    }
  } catch (e) { /* ignore */ }

  return api;
}

function readWithReader(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}
