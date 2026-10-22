/* ==========================================================================
   SHARED: project
   The shared project file ("name.cmrlm.json") that carries one design study
   through the tools: site, massing, plates, parking, facade, sun, grading, egress.
   Spec: docs/project-file-spec.md (the contract; change the spec first).

   Units: feet, square feet, degrees. Plan (x, y): x = east, y = north. z is up.

   Storage (localStorage, shared by every tool on the origin)
     cmrlm.project.index    [{ id, name, updatedAt, bytes }], newest first
     cmrlm.project.<id>     the project file, as JSON text
     cmrlm.project.last     the id of the last saved project

   Rules
   - Every storage access is inside try/catch. On any failure the optional
     `onNotice(message)` (pass it as { onNotice } in the last argument of the
     storage functions) is called ONCE per storage object. The data stays in
     memory with the caller, so the tool keeps working.
   - No function mutates its inputs. writeSection returns a new project.
   - A tool writes only its own section and keeps every other section and every
     unknown key as it was. To avoid overwriting another tool that saved from a
     second tab, load the project fresh, writeSection on that copy, then saveProject.
   - Pure ES module, self-contained (no imports) so a build script can inline it.
     No DOM access: Blob and FileReader are used only when they exist.
   ========================================================================== */

export const FORMAT = "cmrlm-design-tools/project";
export const VERSION = 1;
export const SECTIONS = ["site", "massing", "plates", "parking", "facade", "sun", "grading", "egress"];
export const SIZE_WARN = 3 * 1024 * 1024;
export const SIZE_MAX = 4 * 1024 * 1024;

const LOG_MAX = 200;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const KEY_PREFIX = "cmrlm.project.";
const KEY_INDEX = "cmrlm.project.index";
const KEY_LAST = "cmrlm.project.last";
const PLACEMENT_KEYS = ["x", "y", "rotation", "baseZ"];
const DEFAULT_TOOL = { site: "site", massing: "tower", plates: "plate", parking: "parking", facade: "facade", sun: "tower", grading: "grading", egress: "egress" };
const NEWER_MSG = "This project was saved by a newer version of this tool. You can view it, but changes will not be saved.";

/* ---------- small helpers ---------- */

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function newId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Round to 0.001 ft (and never return -0). */
function r3(v) {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

/** Round to 0.01 (and never return -0). */
function r2(v) {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/** An ISO time for now that is later than every ISO time in `prev`, so updatedAt always moves forward. */
function stamp(...prev) {
  let t = new Date().toISOString();
  for (const p of prev) {
    if (typeof p !== "string") continue;
    const ms = Date.parse(p);
    try {
      if (Number.isFinite(ms) && Date.parse(t) <= ms) t = new Date(ms + 1).toISOString();
    } catch (e) { /* keep t */ }
  }
  return t;
}

/** A usable project id: a non-empty string that does not clash with the other storage keys. */
function okId(id) {
  return typeof id === "string" && id !== "" && id !== "index" && id !== "last";
}

function readOnlyError() {
  const e = new Error(NEWER_MSG);
  e.readOnly = true;
  return e;
}

/* ---------- create, validate, migrate, read ---------- */

/**
 * A new empty project. `frame` is { kind, lat, lon, size, zDatum }; leave it out for a local frame
 * (no site, zDatum "local"). Missing frame fields get their defaults; other values are kept as given.
 */
export function newProject({ name, frame } = {}) {
  const now = new Date().toISOString();
  const f = isObj(frame) ? clone(frame) : {};
  return {
    format: FORMAT,
    version: VERSION,
    id: newId(),
    name: String(name || "").trim() || "Untitled",
    createdAt: now,
    updatedAt: now,
    units: "feet",
    frame: {
      ...f,
      kind: f.kind === undefined ? "local" : f.kind,
      lat: f.lat === undefined ? null : f.lat,
      lon: f.lon === undefined ? null : f.lon,
      size: f.size === undefined ? null : f.size,
      zDatum: f.zDatum === undefined ? (f.kind === "site" ? "NAVD88" : "local") : f.zDatum,
    },
    sections: {},
    log: [],
  };
}

/**
 * Checks the envelope: format, version (a newer one is an error), units, frame, every known section
 * (six keys, numeric placement) and the log. Unknown keys and unknown sections are allowed.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validate(doc) {
  const errors = [];
  const err = (msg) => { if (errors.length < 50) errors.push(msg); };
  if (!isObj(doc)) return { ok: false, errors: ["project: not an object"] };
  if (doc.format !== FORMAT) err(`format: must be "${FORMAT}"`);
  if (!Number.isInteger(doc.version) || doc.version < 1) err("version: must be a whole number, 1 or more");
  else if (doc.version > VERSION) err(`version: ${doc.version} is newer than this tool understands (${VERSION})`);
  if (doc.units !== undefined && doc.units !== "feet") err('units: must be "feet"');
  const f = doc.frame;
  if (!isObj(f)) err("frame: missing or not an object");
  else {
    if (f.kind !== "site" && f.kind !== "local") err('frame.kind: must be "site" or "local"');
    for (const k of ["lat", "lon", "size"]) {
      if (f[k] !== null && !Number.isFinite(f[k])) err(`frame.${k}: must be a number or null`);
    }
    if (typeof f.zDatum !== "string" || !f.zDatum) err('frame.zDatum: must be text such as "NAVD88" or "local"');
  }
  if (doc.sections !== undefined && !isObj(doc.sections)) err("sections: must be an object");
  else if (isObj(doc.sections)) {
    for (const key of SECTIONS) {
      if (!hasOwn(doc.sections, key)) continue;
      const s = doc.sections[key];
      const at = `sections.${key}`;
      if (!isObj(s)) { err(`${at}: must be an object`); continue; }
      if (typeof s.tool !== "string" || !s.tool) err(`${at}.tool: must be a tool id`);
      if (!Number.isFinite(s.schema)) err(`${at}.schema: must be a number`);
      if (typeof s.updatedAt !== "string" || !s.updatedAt) err(`${at}.updatedAt: must be a date string`);
      if (!isObj(s.placement)) err(`${at}.placement: missing or not an object`);
      else for (const k of PLACEMENT_KEYS) if (!Number.isFinite(s.placement[k])) err(`${at}.placement.${k}: must be a number`);
      if (!isObj(s.state)) err(`${at}.state: must be an object`);
      if (!isObj(s.derived)) err(`${at}.derived: must be an object`);
    }
  }
  if (!Array.isArray(doc.log)) err("log: must be an array");
  return { ok: errors.length === 0, errors };
}

/**
 * Brings a project up to VERSION and returns it (the input itself when nothing changes, else a copy).
 * Version 1 needs no change beyond filling a missing `log` with [] and a missing `units` with "feet".
 * A project from a newer version is returned untouched. Section state is the tool's business.
 */
export function migrate(doc) {
  if (!isObj(doc)) return doc;
  if (Number.isFinite(doc.version) && doc.version > VERSION) return doc;
  const blank = (v) => v === undefined || v === null || v === "";
  const older = Number.isFinite(doc.version) && doc.version < VERSION;
  if (!older && doc.log !== undefined && doc.log !== null && !blank(doc.units)) return doc;
  const out = clone(doc);
  if (older) out.version = VERSION;
  if (out.log === undefined || out.log === null) out.log = [];
  if (blank(out.units)) out.units = "feet";
  return out;
}

/** The section object for `key`, or null. Never throws. Treat the result as read-only. */
export function getSection(doc, key) {
  try {
    const secs = doc && doc.sections;
    if (!isObj(secs) || !hasOwn(secs, key)) return null;
    return isObj(secs[key]) ? secs[key] : null;
  } catch (e) {
    return null;
  }
}

/* ---------- write one section ---------- */

/** Adds one entry to the log (newest 200 kept) and moves the project updatedAt to the entry time. */
function appendLog(doc, entry) {
  const log = Array.isArray(doc.log) ? doc.log : [];
  log.push(entry);
  doc.log = log.length > LOG_MAX ? log.slice(log.length - LOG_MAX) : log;
  doc.updatedAt = entry.at;
}

/** The four placement numbers: given values first, then the old placement, then 0. Extra given keys are kept. */
function mergePlacement(given, old) {
  const base = isObj(old) ? old : {};
  const out = {};
  for (const k of PLACEMENT_KEYS) {
    const v = given[k] !== undefined ? given[k] : base[k] !== undefined ? base[k] : 0;
    if (!Number.isFinite(v)) throw new Error(`writeSection: placement.${k} must be a number.`);
    out[k] = v;
  }
  for (const k of Object.keys(given)) if (!hasOwn(out, k)) out[k] = clone(given[k]);
  return out;
}

/**
 * Writes one section and returns a NEW project; the input is not changed.
 * Only the fields given in `patch` (tool, schema, placement, state, derived) are replaced. Unknown keys of
 * the section and of the project stay as they were. A new section gets defaults for what is missing
 * (the usual tool, schema 1, an identity placement, empty state and derived). Sets section.updatedAt and
 * project.updatedAt, appends one log entry { at, tool, action: "write", note } and keeps the newest 200.
 * Throws a plain Error when `key` is not in SECTIONS. Throws an Error with `readOnly = true` when the stored
 * section schema is newer than `patch.schema` (or the project is from a newer version): the tool must not save.
 */
export function writeSection(doc, key, patch) {
  if (!SECTIONS.includes(key)) throw new Error(`Unknown section "${key}". Use one of: ${SECTIONS.join(", ")}.`);
  if (!isObj(doc)) throw new Error("writeSection: the project must be an object.");
  const p = isObj(patch) ? patch : {};
  if (Number.isFinite(doc.version) && doc.version > VERSION) throw readOnlyError();
  const stored = getSection(doc, key);
  if (p.tool !== undefined && (typeof p.tool !== "string" || !p.tool)) throw new Error("writeSection: tool must be a tool id.");
  if (p.schema !== undefined && !(Number.isInteger(p.schema) && p.schema >= 1)) throw new Error("writeSection: schema must be a whole number, 1 or more.");
  for (const k of ["placement", "state", "derived"]) {
    if (p[k] !== undefined && !isObj(p[k])) throw new Error(`writeSection: ${k} must be an object.`);
  }
  // Last: a stored section that is newer than the writer means the writer must not save.
  if (stored && Number.isFinite(stored.schema) && Number.isFinite(p.schema) && stored.schema > p.schema) throw readOnlyError();

  const now = stamp(doc.updatedAt, stored && stored.updatedAt);
  const out = clone(doc);
  if (!isObj(out.sections)) out.sections = {};
  const s = isObj(out.sections[key]) ? out.sections[key] : {};
  s.tool = p.tool !== undefined ? p.tool : (typeof s.tool === "string" && s.tool ? s.tool : DEFAULT_TOOL[key]);
  s.schema = p.schema !== undefined ? p.schema : (Number.isFinite(s.schema) ? s.schema : 1);
  s.updatedAt = now;
  s.placement = p.placement !== undefined ? mergePlacement(p.placement, s.placement) : (isObj(s.placement) ? s.placement : mergePlacement({}, null));
  s.state = p.state !== undefined ? clone(p.state) : (isObj(s.state) ? s.state : {});
  s.derived = p.derived !== undefined ? clone(p.derived) : (isObj(s.derived) ? s.derived : {});
  out.sections[key] = s;
  appendLog(out, { at: now, tool: s.tool, action: "write", note: p.note === undefined || p.note === null ? "" : String(p.note) });
  return out;
}

/* ---------- placement math (spec section 4) ---------- */

/** The placement numbers of a section (or of a bare placement object). A missing number counts as 0. */
function placementOf(s) {
  const p = isObj(s) && isObj(s.placement) ? s.placement : s;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return isObj(p) ? { x: n(p.x), y: n(p.y), rotation: n(p.rotation), baseZ: n(p.baseZ) } : { x: 0, y: 0, rotation: 0, baseZ: 0 };
}

/** [sin, cos] of an angle in degrees, exact for the four quarter turns. */
function sincos(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [0, 1];
  if (d === 90) return [1, 0];
  if (d === 180) return [0, -1];
  if (d === 270) return [-1, 0];
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

function forward(pl, x, y, z) {
  const [s, c] = sincos(pl.rotation);
  return [x * c - y * s + pl.x, x * s + y * c + pl.y, z + pl.baseZ];
}

function inverse(pl, xp, yp, zp) {
  const [s, c] = sincos(pl.rotation);
  const dx = xp - pl.x, dy = yp - pl.y;
  return [dx * c + dy * s, -dx * s + dy * c, zp - pl.baseZ];
}

function zOf(p) {
  return Number.isFinite(p[2]) ? p[2] : 0;
}

function checkDir(dir, fn) {
  if (dir !== "toProject" && dir !== "toLocal") throw new Error(`${fn}: dir must be "toProject" or "toLocal".`);
}

/** Maps a ring of [x, y] or [x, y, z] points. Rounds to 0.001 ft. A point keeps its length (2 or 3 numbers). */
function mapRing(pl, ring, fwd) {
  if (!Array.isArray(ring)) return [];
  return ring.map((p) => {
    const three = Array.isArray(p) && p.length >= 3 && Number.isFinite(p[2]);
    const t = fwd ? forward(pl, p[0], p[1], zOf(p)) : inverse(pl, p[0], p[1], zOf(p));
    return three ? [r3(t[0]), r3(t[1]), r3(t[2])] : [r3(t[0]), r3(t[1])];
  });
}

/**
 * Local point to project point: xp = x cos r - y sin r + placement.x, yp = x sin r + y cos r + placement.y,
 * zp = z + placement.baseZ. `r` is placement.rotation in degrees, counter-clockwise. z is optional (0).
 * `section` is a section object or a bare placement. Returns [xp, yp, zp], not rounded.
 */
export function toProject(section, point) {
  return forward(placementOf(section), point[0], point[1], zOf(point));
}

/** The inverse of toProject: project point to local point [x, y, z]. z is optional (0). Not rounded. */
export function toLocal(section, point) {
  return inverse(placementOf(section), point[0], point[1], zOf(point));
}

/**
 * Transforms a ring (or a 3D line) of points. dir is "toProject" or "toLocal". Returns a new array
 * rounded to 0.001 ft; 2D points stay 2D, 3D points stay 3D (z moves with baseZ).
 */
export function transformRing(section, ring, dir) {
  checkDir(dir, "transformRing");
  return mapRing(placementOf(section), ring, dir === "toProject");
}

/** Transforms a MultiPoly [{ outer, holes }] the same way. Other keys of each polygon are kept. */
export function transformMultiPoly(section, mp, dir) {
  checkDir(dir, "transformMultiPoly");
  const pl = placementOf(section), fwd = dir === "toProject";
  return (Array.isArray(mp) ? mp : []).map((poly) => {
    const q = isObj(poly) ? poly : {};
    return { ...q, outer: mapRing(pl, q.outer, fwd), holes: (Array.isArray(q.holes) ? q.holes : []).map((h) => mapRing(pl, h, fwd)) };
  });
}

/**
 * Site buildings near a massing, in that massing LOCAL frame. `placement` is the massing placement.
 * Includes a building when its local plan bounding box touches the circle of radiusFt around the local
 * origin (a missing radius means no limit). Returns
 *   { blocks:   [{ id, name, x, y, w, d, h, base }],            axis-aligned box of each building (x, y = box center)
 *     polygons: [{ id, name, outer, holes, base, height }] }    the building rings, in the local frame
 * where base is the building base minus placement.baseZ. Numbers are rounded to 0.01 ft (rings to 0.001).
 * Empty lists when the project has no site section.
 * A building with `removed: true` (the user removed it in the Site Model) is skipped from both lists, unless
 * opts.includeRemoved is true; then it is kept and its block and polygon carry `removed: true`.
 */
export function siteContextFor(doc, placement, radiusFt, opts) {
  const includeRemoved = !!(isObj(opts) && opts.includeRemoved);
  const out = { blocks: [], polygons: [] };
  const site = getSection(doc, "site");
  const list = site && isObj(site.derived) && Array.isArray(site.derived.buildings) ? site.derived.buildings : [];
  const pl = placementOf(placement);
  const radius = Number.isFinite(radiusFt) ? radiusFt : Infinity;
  for (const b of list) {
    if (!isObj(b) || !Array.isArray(b.outer) || b.outer.length < 3) continue;
    const removed = b.removed === true;
    if (removed && !includeRemoved) continue;
    const outer = mapRing(pl, b.outer, false);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!(Number.isFinite(minX) && Number.isFinite(minY))) continue;
    const gapX = Math.max(minX, 0, -maxX), gapY = Math.max(minY, 0, -maxY);
    if (Math.hypot(gapX, gapY) > radius) continue;
    const name = typeof b.name === "string" ? b.name : "";
    const height = Number.isFinite(b.height) ? b.height : (Number.isFinite(b.top) && Number.isFinite(b.base) ? b.top - b.base : 0);
    const base = r2((Number.isFinite(b.base) ? b.base : pl.baseZ) - pl.baseZ);
    const block = { id: b.id, name, x: r2((minX + maxX) / 2), y: r2((minY + maxY) / 2), w: r2(maxX - minX), d: r2(maxY - minY), h: r2(height), base };
    const polygon = { id: b.id, name, outer, holes: (Array.isArray(b.holes) ? b.holes : []).map((h) => mapRing(pl, h, false)), base, height: r2(height) };
    if (removed) { block.removed = true; polygon.removed = true; }
    out.blocks.push(block);
    out.polygons.push(polygon);
  }
  return out;
}

/* ---------- size ---------- */

let encoder = null;

/** Bytes of a text when written as UTF-8 (TextEncoder when present, else the string length). */
function utf8Length(text) {
  if (typeof text !== "string") return 0;
  try {
    if (typeof TextEncoder !== "undefined") {
      if (!encoder) encoder = new TextEncoder();
      return encoder.encode(text).length;
    }
  } catch (e) { /* fall through */ }
  return text.length;
}

/** UTF-8 byte length of the project JSON (what saveProject counts against SIZE_WARN and SIZE_MAX). */
export function projectBytes(doc) {
  try {
    return utf8Length(JSON.stringify(doc));
  } catch (e) {
    return 0;
  }
}

/** The section with the most JSON bytes: { key, bytes }. { key: null, bytes: 0 } when there are none. */
export function largestSection(doc) {
  let best = { key: null, bytes: 0 };
  const secs = isObj(doc) && isObj(doc.sections) ? doc.sections : {};
  for (const key of Object.keys(secs)) {
    const bytes = projectBytes(secs[key]);
    if (bytes > best.bytes) best = { key, bytes };
  }
  return best;
}

function fmtSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The text shown when a project is over SIZE_WARN (saved) or over SIZE_MAX (refused). Names the largest section. */
function sizeMessage(doc, bytes, refused) {
  const big = largestSection(doc);
  const part = big.key ? ` The largest part is "${big.key}" (${fmtSize(big.bytes)}).` : "";
  return refused
    ? `This project is ${fmtSize(bytes)}, which is over the ${fmtSize(SIZE_MAX)} limit, so it was not saved.${part} Delete old projects or simplify that part.`
    : `This project is ${fmtSize(bytes)}. Browsers keep about 5 MB for all projects together.${part} Delete old projects to make room.`;
}

/* ---------- storage access (every call inside try/catch, one notice per storage object) ---------- */

const noticed = new WeakSet();
let noticedDefault = false;

/** Calls opts.onNotice(message) once per storage object (the default localStorage counts as one object). */
function notice(storage, opts, message) {
  if (!opts || typeof opts.onNotice !== "function") return;
  if (storage && typeof storage === "object") {
    if (noticed.has(storage)) return;
    noticed.add(storage);
  } else {
    if (noticedDefault) return;
    noticedDefault = true;
  }
  try { opts.onNotice(message); } catch (e) { /* ignore */ }
}

const NO_STORE = "Saving is unavailable in this browser, so projects will only be kept until you close this page.";
const NO_WRITE = "Saving is unavailable in this browser (storage is blocked or full). The project will only be kept until you close this page.";

function backend(storage) {
  // Reading globalThis.localStorage itself can throw (blocked site data).
  return storage || globalThis.localStorage;
}

/** The stored text for a key, or null when missing or when storage fails. */
function readRaw(storage, opts, key) {
  try {
    const raw = backend(storage).getItem(key);
    return raw === undefined || raw === null ? null : String(raw);
  } catch (e) {
    notice(storage, opts, NO_STORE);
    return null;
  }
}

function writeRaw(storage, opts, key, value) {
  try {
    backend(storage).setItem(key, value);
    return true;
  } catch (e) {
    notice(storage, opts, NO_WRITE);
    return false;
  }
}

function removeRaw(storage, opts, key) {
  try {
    backend(storage).removeItem(key);
    return true;
  } catch (e) {
    notice(storage, opts, NO_WRITE);
    return false;
  }
}

const keyFor = (id) => KEY_PREFIX + id;
const byNewest = (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

/** The index entries [{ id, name, updatedAt, bytes }], newest first. A corrupt index is backed up and read as empty. */
function readIndex(storage, opts) {
  const raw = readRaw(storage, opts, KEY_INDEX);
  if (raw === null) return [];
  let arr = null;
  try { arr = JSON.parse(raw); } catch (e) { arr = null; }
  if (!Array.isArray(arr)) {
    notice(storage, opts, "The project list could not be read and was reset. A backup copy of the old list was kept.");
    try { backend(storage).setItem(KEY_INDEX + ".corrupt", raw); } catch (e) { /* ignore */ }
    return [];
  }
  const seen = new Set(), out = [];
  for (const e of arr) {
    if (!isObj(e) || !okId(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      name: typeof e.name === "string" && e.name ? e.name : "Untitled",
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : "",
      bytes: Number.isFinite(e.bytes) ? e.bytes : 0,
    });
  }
  return out.sort(byNewest);
}

function writeIndex(storage, opts, entries) {
  return writeRaw(storage, opts, KEY_INDEX, JSON.stringify(entries.slice().sort(byNewest)));
}

/* ---------- saved projects ---------- */

/**
 * The saved projects as index entries [{ id, name, updatedAt, bytes }], newest first (copies).
 * `storage` is a Storage-like object (getItem, setItem, removeItem); the default is localStorage.
 * `opts` is optional: { onNotice(message) }, called once when storage fails.
 */
export function listProjects(storage, opts) {
  return readIndex(storage, opts);
}

/**
 * Loads, migrates and validates a saved project. Returns null when it is missing, unreadable, invalid,
 * or from a newer version of the tools (opts.onNotice then says why). Does not write anything.
 */
export function loadProject(storage, id, opts) {
  if (!okId(id)) return null;
  const raw = readRaw(storage, opts, keyFor(id));
  if (raw === null) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    notice(storage, opts, "This project could not be read, so it was not opened.");
    return null;
  }
  if (isObj(obj) && Number.isFinite(obj.version) && obj.version > VERSION) {
    notice(storage, opts, "This project was made by a newer version of the design tools, so it cannot be opened here.");
    return null;
  }
  const doc = migrate(obj);
  return validate(doc).ok ? doc : null;
}

/**
 * Saves a project and updates the index (newest first) and cmrlm.project.last. The project is validated
 * first, so a file that loadProject would reject is never stored. Returns { ok, bytes, warning }:
 *   - over SIZE_MAX: ok false, nothing written, warning names the largest section
 *   - over SIZE_WARN: ok true, warning set (also names the largest section)
 *   - storage failure or an invalid project: ok false, warning says why
 * `warning` is null when there is nothing to say. The project object itself is not changed.
 */
export function saveProject(storage, doc, opts) {
  const m = migrate(doc);
  if (isObj(m) && Number.isFinite(m.version) && m.version > VERSION) return { ok: false, bytes: 0, warning: NEWER_MSG };
  const check = validate(m);
  if (!check.ok || !okId(m.id)) {
    const why = !check.ok ? check.errors[0] : 'id: must be text other than "index" or "last"';
    return { ok: false, bytes: 0, warning: `This project could not be saved because it is not valid (${why}).` };
  }
  let text;
  try {
    text = JSON.stringify(m);
  } catch (e) {
    return { ok: false, bytes: 0, warning: "This project could not be saved because it could not be written as text." };
  }
  const bytes = utf8Length(text);
  if (bytes > SIZE_MAX) return { ok: false, bytes, warning: sizeMessage(m, bytes, true) };
  if (!writeRaw(storage, opts, keyFor(m.id), text)) return { ok: false, bytes, warning: NO_WRITE };
  const entry = {
    id: m.id,
    name: typeof m.name === "string" && m.name ? m.name : "Untitled",
    updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : (typeof m.createdAt === "string" ? m.createdAt : ""),
    bytes,
  };
  const index = readIndex(storage, opts).filter((e) => e.id !== m.id);
  index.unshift(entry);
  if (!writeIndex(storage, opts, index)) return { ok: false, bytes, warning: NO_WRITE };
  writeRaw(storage, opts, KEY_LAST, m.id);
  return { ok: true, bytes, warning: bytes > SIZE_WARN ? sizeMessage(m, bytes, false) : null };
}

/**
 * Removes a saved project: its file, its index entry, and cmrlm.project.last when it points at it.
 * Returns true when something was removed.
 */
export function deleteProject(storage, id, opts) {
  if (!okId(id)) return false;
  const existed = readRaw(storage, opts, keyFor(id)) !== null;
  const entries = readIndex(storage, opts);
  const listed = entries.some((e) => e.id === id);
  removeRaw(storage, opts, keyFor(id));
  if (listed) writeIndex(storage, opts, entries.filter((e) => e.id !== id));
  if (readRaw(storage, opts, KEY_LAST) === id) removeRaw(storage, opts, KEY_LAST);
  return existed || listed;
}

/* ---------- export, import, handoff ---------- */

/** "Ravinia test" -> "ravinia-test": lowercase, spaces to dashes, only letters, digits and dashes. */
function slug(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim()
    .replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
}

/** "Name" -> "Name (2)", "Name (3)" ... the first one not in `taken` (case-insensitive). */
function copyName(name, taken) {
  const lower = new Set(taken.map((n) => String(n).trim().toLowerCase()));
  const base = String(name || "").trim() || "Untitled";
  for (let n = 2; n < 100000; n++) {
    const candidate = `${base} (${n})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${newId()})`;
}

function readWithReader(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") { reject(new Error("No file reader.")); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

/**
 * The project as a download: { filename: "<name>.cmrlm.json", blob } (an application/json Blob).
 * Where Blob does not exist (Node before 18) it returns { filename, text } instead.
 */
export function exportProject(doc) {
  const filename = `${slug(isObj(doc) ? doc.name : "")}.cmrlm.json`;
  const text = JSON.stringify(doc);
  if (typeof Blob !== "undefined") return { filename, blob: new Blob([text], { type: "application/json" }) };
  return { filename, text };
}

/**
 * Imports a project file, then saves it. `file` is a File or Blob (anything with .text()) or a string of JSON.
 * Validates and migrates it. When its id is already in the list, the copy gets a new id and the name
 * "Name (2)" (the first free number). Resolves { doc, renamed } (plus `warning` when the saved file is over
 * SIZE_WARN). Rejects with an Error whose message can be shown to the user.
 */
export async function importProject(file, storage, opts) {
  if (file === undefined || file === null) throw new Error("No file was chosen.");
  if (typeof file !== "string" && typeof file.size === "number" && file.size > MAX_IMPORT_BYTES) {
    throw new Error("That file is too large to be a project file.");
  }
  let text;
  try {
    text = typeof file === "string" ? file : typeof file.text === "function" ? await file.text() : await readWithReader(file);
  } catch (e) {
    throw new Error("The file could not be read.");
  }
  if (typeof text !== "string") throw new Error("The file could not be read.");
  let obj;
  try {
    obj = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new Error("This file is not valid JSON, so it is not a project file.");
  }
  if (!isObj(obj) || obj.format !== FORMAT) throw new Error("This file is not a design tools project file.");
  if (Number.isFinite(obj.version) && obj.version > VERSION) {
    throw new Error("This file was made by a newer version of the design tools. Update the tools and try again.");
  }
  const doc = migrate(obj);
  const check = validate(doc);
  if (!check.ok) throw new Error(`This project file is not valid: ${check.errors[0]}.`);

  if (typeof doc.name !== "string" || !doc.name.trim()) doc.name = "Untitled";
  let renamed = false;
  if (!okId(doc.id)) {
    doc.id = newId();
  } else {
    const entries = readIndex(storage, opts);
    if (entries.some((e) => e.id === doc.id) || readRaw(storage, opts, keyFor(doc.id)) !== null) {
      doc.id = newId();
      doc.name = copyName(doc.name, entries.map((e) => e.name));
      renamed = true;
    }
  }
  const res = saveProject(storage, doc, opts);
  if (!res.ok) throw new Error(res.warning || "The project could not be saved.");
  const out = { doc, renamed };
  if (res.warning) out.warning = res.warning;
  return out;
}

/**
 * The project id in `?project=<id>`. `location` is a URL string (or just its query) or an object with a
 * `search` text, such as the page location. Returns null when there is no usable id.
 */
export function projectIdFromUrl(location) {
  try {
    let s = typeof location === "string" ? location : location && typeof location.search === "string" ? location.search : location && typeof location.href === "string" ? location.href : "";
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    const q = s.indexOf("?");
    if (q >= 0) s = s.slice(q + 1);
    const id = new URLSearchParams(s).get("project");
    const t = typeof id === "string" ? id.trim() : "";
    return okId(t) ? t : null;
  } catch (e) {
    return null;
  }
}

/**
 * Hands the project to another tool: saves a copy of `doc` with the log entry
 * { at, tool: fromToolId, action: "send", note: "<from> → <to>" } and returns the URL `../<toolId>/?project=<id>`.
 * `doc` itself is not changed. Throws when the project cannot be saved (the next tool could not load it).
 */
export function sendTo(storage, doc, toolId, fromToolId, opts) {
  if (typeof toolId !== "string" || !/^[\w-]+$/.test(toolId)) throw new Error('sendTo: toolId must be a tool id such as "plate".');
  if (!isObj(doc)) throw new Error("sendTo: the project must be an object.");
  if (Number.isFinite(doc.version) && doc.version > VERSION) throw readOnlyError();
  const from = typeof fromToolId === "string" && fromToolId ? fromToolId : "workspace";
  const m = migrate(doc);
  const next = m === doc ? clone(doc) : m;
  appendLog(next, { at: stamp(next.updatedAt), tool: from, action: "send", note: `${from} → ${toolId}` });
  const res = saveProject(storage, next, opts);
  if (!res.ok) {
    const e = new Error(res.warning || "The project could not be saved.");
    e.saveFailed = true;
    throw e;
  }
  return `../${toolId}/?project=${encodeURIComponent(next.id)}`;
}
