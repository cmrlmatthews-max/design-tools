/* SHARED: store. One state object; get/set by path, subscribe, undo/redo (50 steps). Live sets coalesce into one undo step on commit(). */
const Store = (() => {
  let state = defaultState();
  let version = 0;
  let gesture = null;                  // { base, path } while a live drag is open
  const past = [], future = [];
  const listeners = new Set();

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
  function notify(info) {
    version++;
    for (const fn of listeners) { try { fn(state, info); } catch (e) { console.error(e); } }
  }
  function pushHistory(snapshot) {
    past.push(snapshot);
    while (past.length > CONFIG.limits.maxHistory) past.shift();
    future.length = 0;
  }

  const get = (path) => getIn(state, keysOf(path));

  /** End a live gesture; it becomes a single undo step. */
  function commit() {
    if (!gesture) return false;
    const g = gesture; gesture = null;
    if (!same(g.base, state)) pushHistory(g.base);
    notify({ kind: 'commit', path: g.path, live: false });
    return true;
  }

  /** Set a value by dot path. opts.live = continuous drag (coalesced until commit()). opts.merge = no new undo step (it joins the one before). */
  function set(path, value, opts = {}) {
    const ks = keysOf(path);
    if (!ks.length) return replace(value);
    if (same(getIn(state, ks), value)) return false;
    const pathStr = ks.join('.');
    if (opts.live) {
      if (!gesture) gesture = { base: clone(state), path: pathStr };
    } else if (opts.merge) {
      if (gesture) commit();                 // follows another change: both undo together (the page keeps site neighbors in step with the placement)
    } else {
      if (gesture) commit();
      pushHistory(clone(state));
    }
    setIn(state, ks, (value !== null && typeof value === 'object') ? clone(value) : value);
    notify({ kind: 'set', path: pathStr, live: !!opts.live });
    return true;
  }
  function replace(next, opts = {}) {
    if (gesture) commit();
    if (opts.resetHistory) { past.length = 0; future.length = 0; } else pushHistory(clone(state));
    state = clone(next);
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
    state = future.pop();
    notify({ kind: 'redo', path: '', live: false });
    return true;
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return {
    get, set, commit, replace, undo, redo, subscribe,
    raw: () => state,                         // live reference; treat as read-only
    snapshot: () => clone(state),
    version: () => version,
    canUndo: () => past.length > 0 || (gesture && !same(gesture.base, state)),
    canRedo: () => future.length > 0,
    gestureActive: () => !!gesture,
    gesturePath: () => (gesture ? gesture.path : ''),
    historyDepth: () => past.length,
  };
})();
