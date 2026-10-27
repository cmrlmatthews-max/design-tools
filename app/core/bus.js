/* ==========================================================================
   CORE: bus (app/CONTRACT.md section 1)
   One event bus for the page. Modules talk through it, not through globals.
   A handler that throws is logged and the other handlers still run.

   Events used across the app:
     project:open    { doc }                                  a different project is open (or null)
     project:change  { doc, keys, source, tool }              sections changed; source 'local' | 'storage'
     section:<key>   { doc, section, source, tool }           one section changed
     tool:active     { id, prev }
     layers:change   {}
     style:change    { style }
     frame:shift     { shift }
     selection       { item, owner }
     notice          { text, kind }                           show a toast
   `tool` is the writer's tool id: patch.tool on a local write, the stored
   section's tool on a reload, null when unknown.
   ========================================================================== */

/** A new bus. The page uses the shared `bus` below; tests make their own. */
export function createBus() {
  const map = new Map();                  // evt -> Set of handlers

  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = map.get(evt);
    if (!set) { set = new Set(); map.set(evt, set); }
    set.add(fn);
    return () => off(evt, fn);
  }

  function off(evt, fn) {
    const set = map.get(evt);
    if (!set) return;
    set.delete(fn);
    if (!set.size) map.delete(evt);
  }

  function once(evt, fn) {
    const wrap = (payload) => { off(evt, wrap); return fn(payload); };
    return on(evt, wrap);
  }

  function emit(evt, payload) {
    const set = map.get(evt);
    if (!set) return;
    // A copy, so a handler can add or remove handlers while the event runs.
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { try { console.error(e); } catch (e2) { /* no console */ } }
    }
  }

  return { on, off, once, emit };
}

export const bus = createBus();
