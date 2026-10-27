/* ==========================================================================
   CORE: store (app/CONTRACT.md section 2)
   One state object per tool with undo and redo. A port of `Store` in
   build/tower/shell.html (the same code runs in build/grading and build/parking),
   made into a factory so each tool gets its own instance.

   - Dot paths: 'segments.0.floors'. A number part indexes an array. An array of
     parts also works.
   - A live set (a drag) makes no undo step yet. The next commit() or the next
     non-live set closes the gesture as ONE undo step.
   - opts.merge: no new undo step; the change joins the step before it (the
     tools use it to keep site neighbors in step with the placement).
   - The history keeps `limit` steps (50).
   - Listeners get (state, { kind, path, live }). kind is 'set', 'update',
     'commit', 'replace', 'undo' or 'redo'.
   ========================================================================== */

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (p) => (Array.isArray(p) ? p.map(String) : String(p == null ? '' : p).split('.').filter(Boolean));

function getIn(root, ks) {
  let o = root;
  for (const k of ks) { if (o == null) return undefined; o = o[k]; }
  return o;
}

function setIn(root, ks, value) {
  let o = root;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = value;
}

export function createStore({ initial = {}, limit = 50 } = {}) {
  let state = clone(initial === undefined ? {} : initial);
  let version = 0;
  let gesture = null;                  // { base, path } while a live drag is open
  const past = [], future = [];
  const listeners = new Set();
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;

  function notify(info) {
    version++;
    for (const fn of [...listeners]) {
      try { fn(state, info); } catch (e) { try { console.error(e); } catch (e2) { /* no console */ } }
    }
  }

  function pushHistory(snapshot) {
    past.push(snapshot);
    while (past.length > max) past.shift();
    future.length = 0;
  }

  /** Opens a gesture (live), or closes one and records the step before a change. */
  function beforeChange(path, opts) {
    if (opts.live) {
      if (!gesture) gesture = { base: clone(state), path };
    } else if (opts.merge) {
      if (gesture) commit();
    } else {
      if (gesture) commit();
      pushHistory(clone(state));
    }
  }

  const get = (path) => getIn(state, keysOf(path));

  /** Ends a live gesture. It becomes a single undo step (none when nothing changed). */
  function commit() {
    if (!gesture) return false;
    const g = gesture; gesture = null;
    if (!same(g.base, state)) pushHistory(g.base);
    notify({ kind: 'commit', path: g.path, live: false });
    return true;
  }

  /** Sets a value by dot path. Returns false when the value is the same. */
  function set(path, value, opts = {}) {
    const o = opts || {};
    const ks = keysOf(path);
    if (!ks.length) return replace(value);
    if (same(getIn(state, ks), value)) return false;
    const pathStr = ks.join('.');
    beforeChange(pathStr, o);
    setIn(state, ks, (value !== null && typeof value === 'object') ? clone(value) : value);
    notify({ kind: 'set', path: pathStr, live: !!o.live });
    return true;
  }

  /** fn(draft) changes a deep clone (or returns a new state). One undo step; none when nothing changed. */
  function update(fn, opts = {}) {
    const o = opts || {};
    if (typeof fn !== 'function') return false;
    const draft = clone(state);
    const out = fn(draft);
    const next = out === undefined ? draft : out;
    if (same(next, state)) return false;
    beforeChange('', o);
    state = clone(next);
    notify({ kind: 'update', path: '', live: !!o.live });
    return true;
  }

  /** Replaces the whole state. undoable false (or resetHistory true, the old name) clears the history. */
  function replace(next, opts = {}) {
    const o = opts || {};
    if (gesture) commit();
    const reset = o.undoable === false || o.resetHistory === true;
    if (reset) { past.length = 0; future.length = 0; } else pushHistory(clone(state));
    state = clone(next === undefined ? {} : next);
    notify({ kind: 'replace', path: '', live: false });
    return true;
  }

  function undo() {
    commit();
    if (!past.length) return false;
    future.push(clone(state));
    state = past.pop();
    notify({ kind: 'undo', path: '', live: false });
    return true;
  }

  function redo() {
    commit();
    if (!future.length) return false;
    past.push(clone(state));
    while (past.length > max) past.shift();
    state = future.pop();
    notify({ kind: 'redo', path: '', live: false });
    return true;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    raw: () => state,                         // live reference; treat as read-only
    get, set, update, commit, replace, undo, redo, subscribe,
    canUndo: () => past.length > 0 || (!!gesture && !same(gesture.base, state)),
    canRedo: () => future.length > 0,
    snapshot: () => clone(state),
    // the same extras as the old Store
    version: () => version,
    gestureActive: () => !!gesture,
    gesturePath: () => (gesture ? gesture.path : ''),
    historyDepth: () => past.length,
  };
}
