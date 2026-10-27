/* ==========================================================================
   KEYS
   One keyboard router for the page. Shell keys first, then the active tool's keys.
   createKeys() -> { bind(scope, combo, fn) -> off, setActive(scope), active() }
   combo: 'mod+z', 'shift+mod+z', 'alt+1', '1', 'd', 'Escape', '\\', 'ArrowUp', 'Delete'.
     mod = Cmd on a Mac, Ctrl elsewhere (either works on any system). Order of the parts does not matter.
     Letters and digits match the physical key too (Shift+1 still reads as '1'; Alt+D on a Mac still reads as 'd').
   fn(event) returns false when it did not use the key; the next binding then gets it. Otherwise the router calls preventDefault.
   Keys typed in a text field, select, or contenteditable are ignored (the field handles its own Enter and Escape).
   Nothing runs while a modal is open (body.has-modal).
   ========================================================================== */

const ALIAS = { esc: 'escape', del: 'delete', space: ' ', spacebar: ' ', plus: '+', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', cmd: 'mod', ctrl: 'mod', meta: 'mod', option: 'alt' };

/** 'Shift+Mod+Z' -> 'shift+mod+z' in a fixed order: shift, alt, mod, key. */
function normCombo(combo) {
  const raw = String(combo);
  const parts = raw === '+' ? ['+'] : raw.split('+').map((p, i, a) => (p === '' && i === a.length - 1 ? '+' : p)).filter((p) => p !== '');
  const mods = new Set();
  let key = '';
  for (let p of parts) {
    p = p.toLowerCase();
    p = ALIAS[p] || p;
    if (p === 'shift' || p === 'alt' || p === 'mod') mods.add(p); else key = p;
  }
  return [mods.has('shift') && 'shift', mods.has('alt') && 'alt', mods.has('mod') && 'mod', key].filter(Boolean).join('+');
}

/** The key part of an event: letters and digits from e.code when there is one, else e.key lowercased. */
function eventKey(e) {
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const k = e.key || '';
  return k.length === 1 ? k.toLowerCase() : k.toLowerCase();
}

/** The combos an event can match, most specific first. A symbol key also matches without its Shift ('?' needs Shift). */
function eventCombos(e) {
  const key = eventKey(e);
  const mod = e.metaKey || e.ctrlKey;
  const head = [e.shiftKey && 'shift', e.altKey && 'alt', mod && 'mod'].filter(Boolean);
  const out = [[...head, key].join('+')];
  const isSymbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (isSymbol && e.shiftKey) out.push([e.altKey && 'alt', mod && 'mod', key].filter(Boolean).join('+'));
  if (e.key && e.key.length === 1 && e.key.toLowerCase() !== key) {     // keyboards where the code and the character differ
    out.push([...head, e.key.toLowerCase()].join('+'));
  }
  return out;
}

function isTyping(target) {
  if (!target || target === document.body) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (target.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'file', 'image'].includes(type);
  }
  return false;
}

export function createKeys({ target = (typeof window !== 'undefined' ? window : null) } = {}) {
  const scopes = new Map();                 // scope -> Map(combo -> [fn])
  let active = 'shell';

  function bind(scope, combo, fn) {
    const c = normCombo(combo);
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    const m = scopes.get(scope);
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(fn);
    return () => { const arr = m.get(c); if (!arr) return; const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); };
  }
  function setActive(scope) { active = scope || 'shell'; }

  function run(scope, combos, e) {
    const m = scopes.get(scope);
    if (!m) return false;
    for (const c of combos) {
      const fns = m.get(c);
      if (!fns || !fns.length) continue;
      for (const fn of fns.slice().reverse()) {          // the newest binding first
        let r;
        try { r = fn(e); } catch (err) { console.error('Key handler failed:', c, err); r = true; }
        if (r !== false) return true;
      }
    }
    return false;
  }

  function onKeyDown(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('has-modal')) return;
    if (isTyping(e.target)) return;
    const combos = eventCombos(e);
    const order = active && active !== 'shell' ? ['shell', active] : ['shell'];
    for (const scope of order) {
      if (run(scope, combos, e)) { e.preventDefault(); return; }
    }
  }
  if (target) target.addEventListener('keydown', onKeyDown);

  return {
    bind, setActive,
    active: () => active,
    dispose: () => { if (target) target.removeEventListener('keydown', onKeyDown); },
    _norm: normCombo,
  };
}
