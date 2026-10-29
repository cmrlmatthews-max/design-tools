/* ==========================================================================
   UI KIT
   Small DOM helpers for the shell and the tools: h(), ICONS, Toast, Pop, confirmDialog, and Controls.
   Controls is an ES-module port of build/tower/07_controls.js. The call shapes stay the same, so the tool
   ports can reuse their panel code. It has no Tower globals: a widget that needs a parser takes it as an option.
   Class names here match app/shell.css.
   ========================================================================== */

/* ---- h --------------------------------------------------------------------------------------------- */

/**
 * Makes an element. attrs: class, style (object or string), html (inner HTML), dataset (object),
 * on<Event> (function), any other attribute. true sets an empty attribute; null, undefined and false skip it.
 * Children: strings, numbers, nodes, and nested arrays. null and false are skipped.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText = v;
      else for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, kids) {
  for (const kid of [kids].flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

/* ---- icons ------------------------------------------------------------------------------------------ */

const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** Thin-line icons, 20 px, stroke currentColor. Original glyphs. */
export const ICONS = {
  // tools
  site: svg('<path d="M3 18c3-2.2 5.5-2.2 8.5 0s6 2.2 9.5 0"/><path d="M5 13.5c2.4-1.9 4.8-1.9 7.2 0s4.6 1.9 6.8 0"/><path d="M8 9c1.4-1.2 2.9-1.2 4.3 0s2.8 1.2 4.2 0"/><path d="M11 5.2c.6-.4 1.3-.4 2 0"/>'),
  tower: svg('<path d="M4 21h16"/><path d="M8.5 21V6.5L12 4l3.5 2.5V21"/><path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h7"/>'),
  parking: svg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M10 17V8h3.2a2.6 2.6 0 010 5.2H10"/>'),
  grading: svg('<path d="M3 18.5L21 8"/><path d="M3 13.5h18"/><path d="M6 13.5v3.2M9 13.5v1.5"/><path d="M15 13.5V12M18 13.5v-3.3"/>'),
  plates: svg('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 12h18M9 5v14M15 12v7"/>'),
  layers: svg('<path d="M12 4l8.5 4.2L12 12.4 3.5 8.2z"/><path d="M3.5 12.2l8.5 4.2 8.5-4.2"/><path d="M3.5 16l8.5 4.2 8.5-4.2"/>'),
  // shell
  project: svg('<path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2h8a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z"/>'),
  undo: svg('<path d="M9 6L4.5 10.5 9 15"/><path d="M4.5 10.5H15a4.5 4.5 0 010 9h-3"/>'),
  redo: svg('<path d="M15 6l4.5 4.5L15 15"/><path d="M19.5 10.5H9a4.5 4.5 0 000 9h3"/>'),
  export: svg('<path d="M12 4v10.5"/><path d="M7.5 10L12 14.5 16.5 10"/><path d="M4.5 15.5v3A1.5 1.5 0 006 20h12a1.5 1.5 0 001.5-1.5v-3"/>'),
  camera: svg('<path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.6-2.2h5.8L16.5 7h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z"/><circle cx="12" cy="12.8" r="3.3"/>'),
  prompt: svg('<path d="M4.5 5.5h15v10h-9l-4.5 3.8V15.5H4.5z"/><path d="M8 9h8M8 12h5"/>'),
  collapse: svg('<path d="M7.5 4.5L12 9l4.5-4.5"/><path d="M7.5 19.5L12 15l4.5 4.5"/><path d="M5 12h14"/>'),
  expand: svg('<path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M7.5 15.5L12 20l4.5-4.5"/><path d="M5 12h14"/>'),
  panels: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.5" cy="12" r="1.1"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M4 4l16 16"/><path d="M9.9 6A9.8 9.8 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-2.9 3.7M6.6 7.6A16 16 0 002.5 12s3.5 6.5 9.5 6.5c1.4 0 2.7-.4 3.8-.9"/><path d="M9.9 10a3 3 0 004.1 4.1"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  warn: svg('<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.2"/><circle cx="12" cy="17" r=".4"/>'),
  // extras for the tools
  chevron: svg('<path d="M6.5 9.5L12 15l5.5-5.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  trash: svg('<path d="M4.5 7h15"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 12.5h9l1-12.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  home: svg('<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19.5h12V9.5"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".4"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2"/>'),
};

/** Icon element: <span class="ico-wrap">svg</span>. */
export function icon(name, cls = '') {
  return h('span', { class: `ico-wrap ${cls}`.trim(), 'aria-hidden': 'true', html: ICONS[name] || '' });
}

/* ---- units (default parsers for Controls) ------------------------------------------------------------ */

const grouped = (n, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** 312.5 -> 312'-6" (nearest inch). */
function formatFeetInches(ft) {
  if (typeof ft !== 'number' || !isFinite(ft)) return '—';
  const totalIn = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(totalIn / 12), i = totalIn % 12;
  return `${ft < 0 && totalIn > 0 ? '-' : ''}${grouped(f)}'-${i}"`;
}
const formatArea = (sf) => (typeof sf === 'number' && isFinite(sf)) ? `${grouped(Math.round(sf) || 0)} sf` : '—';
const formatInt = (n) => (typeof n === 'number' && isFinite(n)) ? grouped(Math.round(n) || 0) : '—';
const formatRatio = (n, d = 2) => (typeof n === 'number' && isFinite(n)) ? grouped(n, d) : '—';
const formatDeg = (n) => `${Math.round(n)}°`;
/** Parses "10'-6\"", "10.5", "10'", "6\"", "10 ft 6 in", "10-6", "6 1/2\"" to feet. NaN when invalid. */
function parseLength(input) {
  if (typeof input === 'number') return isFinite(input) ? input : NaN;
  let s = String(input == null ? '' : input).trim().toLowerCase();
  s = s.replace(/[, ]/g, '').replace(/[′’‘]/g, "'").replace(/[″“”]/g, '"').replace(/\s+/g, ' ');
  if (!s) return NaN;
  let sign = 1;
  if (s[0] === '-') { sign = -1; s = s.slice(1).trim(); } else if (s[0] === '+') { s = s.slice(1).trim(); }
  const NUM = '(\\d+\\.?\\d*|\\.\\d+)';
  if (new RegExp('^' + NUM + '$').test(s)) return sign * parseFloat(s);
  const parseInches = (t) => {
    t = t.trim().replace(/\s*(?:"|in\.?|inch|inches)$/, '').trim();
    if (t === '') return 0;
    let m;
    if ((m = t.match(new RegExp('^' + NUM + '$')))) return parseFloat(m[1]);
    if ((m = t.match(/^(\d+)\s*\/\s*(\d+)$/))) return +m[2] ? m[1] / m[2] : NaN;
    if ((m = t.match(new RegExp('^' + NUM + '\\s+(\\d+)\\s*/\\s*(\\d+)$')))) return +m[3] ? parseFloat(m[1]) + m[2] / m[3] : NaN;
    return NaN;
  };
  let m;
  if ((m = s.match(new RegExp('^' + NUM + "\\s*(?:'|ft\\.?|feet|foot)\\s*-?\\s*(.*)$")))) {
    const inch = parseInches(m[2]);
    return isNaN(inch) ? NaN : sign * (parseFloat(m[1]) + inch / 12);
  }
  if (/("|in\.?|inch|inches)$/.test(s)) {
    const inch = parseInches(s);
    return isNaN(inch) ? NaN : sign * inch / 12;
  }
  if ((m = s.match(new RegExp('^' + NUM + '\\s*-\\s*(.+)$')))) {
    const inch = parseInches(m[2]);
    return isNaN(inch) ? NaN : sign * (parseFloat(m[1]) + inch / 12);
  }
  return NaN;
}
/** Plain number with optional decoration ("45°", "20%", "1,200 sf"). NaN when invalid. */
function parseNumber(input) {
  if (typeof input === 'number') return isFinite(input) ? input : NaN;
  const s = String(input == null ? '' : input).replace(/[,\s°%]|sf$/gi, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
/** Same functions as Units in build/tower/shell.html. */
export const Units = { formatFeetInches, formatArea, formatInt, formatRatio, formatDeg, parseLength, parseNumber, grouped };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/* ---- Toast ------------------------------------------------------------------------------------------ */

export const Toast = {
  /** show(text, { kind: 'info'|'warn'|'error'|'good', ms }) ; the old call shape show(text, kind, ms) works too. */
  show(text, opts = {}, legacyMs) {
    const o = typeof opts === 'string' ? { kind: opts, ms: legacyMs } : (opts || {});
    const kind = o.kind || 'info';
    const ms = o.ms == null ? 2600 : o.ms;
    const host = document.getElementById('toasts') || document.body;
    const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    t.addEventListener('click', () => t.remove());
    host.append(t);
    while (host.querySelectorAll('.toast').length > 4) host.querySelector('.toast').remove();
    if (ms > 0) setTimeout(() => t.remove(), ms);
    return t;
  },
};

/* ---- Pop: an anchored menu ---------------------------------------------------------------------------- */

export const Pop = (() => {
  let cur = null;
  function close() {
    if (!cur) return;
    const c = cur; cur = null;
    c.el.remove();
    document.removeEventListener('pointerdown', c.onDown, true);
    document.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('resize', close);
    if (c.anchor && c.anchor.setAttribute) c.anchor.setAttribute('aria-expanded', 'false');
    if (c.onClose) { try { c.onClose(); } catch (e) { /* ignore */ } }
  }
  function menuFrom(items) {
    const el = h('div', { role: 'menu' });
    const ticks = items.some((it) => it && typeof it.checked === 'boolean');
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { el.append(h('div', { class: 'pop-sep', role: 'separator' })); continue; }
      if (it.heading) { el.append(h('div', { class: 'pop-head' }, it.heading)); continue; }
      const btn = h('button', {
        class: 'pop-item', type: 'button', role: ticks ? 'menuitemcheckbox' : 'menuitem',
        'aria-checked': ticks ? String(!!it.checked) : null, disabled: !!it.disabled,
      },
      ticks ? h('span', { class: 'pop-tick', html: it.checked ? ICONS.check : '' }) : null,
      it.icon ? h('span', { class: 'pop-ico', html: ICONS[it.icon] || '' }) : null,
      h('span', { class: 'grow' }, it.label, it.note ? h('small', null, it.note) : null),
      it.hint ? h('span', { class: 'pop-hint' }, it.hint) : null);
      btn.addEventListener('click', () => {
        if (it.disabled) return;
        close();
        if (typeof it.action === 'function') { try { const r = it.action(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); } }
      });
      el.append(btn);
    }
    return el;
  }
  /**
   * open(anchorEl, items | element, { align: 'left'|'right', onClose }) -> true when opened, false when it closed
   * the same anchor's menu (a second tap closes it). items: [{ label, action, disabled, checked, sep, hint, note, icon, heading }].
   */
  function open(anchor, items, opts = {}) {
    const wasSame = cur && cur.anchor === anchor;
    close();
    if (wasSame) return false;
    const el = Array.isArray(items) ? menuFrom(items) : items;
    el.classList.add('pop');
    el.style.visibility = 'hidden';
    el.style.left = '0px'; el.style.top = '0px';
    document.body.append(el);
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth;
    let left = opts.align === 'right' ? r.right - w : r.left;
    left = clamp(left, 8, Math.max(8, vw - w - 8));
    el.style.left = `${left}px`;
    if (r.top > vh / 2) {                    // anchor in the lower half: open above it
      const maxH = Math.max(160, r.top - 6 - 12);
      el.style.maxHeight = `${maxH}px`;
      el.style.top = `${Math.max(12, r.top - 6 - Math.min(el.offsetHeight, maxH))}px`;
    } else {
      const top = Math.min(r.bottom + 6, vh - 120);
      el.style.top = `${top}px`;
      el.style.maxHeight = `${Math.max(160, vh - top - 12)}px`;
    }
    el.style.visibility = '';
    if (anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
    const onDown = (e) => { if (!el.contains(e.target) && !(anchor.contains && anchor.contains(e.target))) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); if (anchor.focus) anchor.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = [...el.querySelectorAll('.pop-item:not([disabled])')];
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
        list[n].focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    cur = { el, anchor, onDown, onKey, onClose: opts.onClose };
    return true;
  }
  return { open, close, isOpen: () => !!cur };
})();

/* ---- confirm dialog ------------------------------------------------------------------------------------ */

/**
 * confirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false }) -> Promise<boolean>.
 * The old shape confirmDialog(message, okLabel, danger) works too.
 */
export function confirmDialog(o, okLegacy, dangerLegacy) {
  const opt = typeof o === 'string' ? { body: o, ok: okLegacy, danger: dangerLegacy } : (o || {});
  const { title = '', body = '', ok = 'OK', cancel = 'Cancel', danger = false } = opt;
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const prevFocus = document.activeElement;
    const okBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button' }, ok || 'OK');
    const cancelBtn = h('button', { class: 'btn outline', type: 'button' }, cancel || 'Cancel');
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      document.body.classList.remove('has-modal');
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); }
      else if (e.key === 'Tab') {                 // keep focus on the two buttons
        e.preventDefault();
        (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
      }
    };
    okBtn.addEventListener('click', () => done(true));
    cancelBtn.addEventListener('click', () => done(false));
    const titleId = `dlg${Math.random().toString(36).slice(2, 8)}`;
    back.append(h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : null },
      title ? h('h2', { class: 'modal-title', id: titleId }, title) : null,
      body ? h('div', { class: 'modal-body' }, body) : null,
      h('div', { class: 'modal-actions' }, cancelBtn, okBtn)));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    document.body.classList.add('has-modal');
    (danger ? cancelBtn : okBtn).focus();
  });
}

/* ---- Controls ------------------------------------------------------------------------------------------- */

const CARET_SVG = '<svg class="caret" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * Makes one Controls set with its own refresh registry. `Controls` (the export) is one shared set;
 * a tool can call Controls.create() for its own set so refreshAll() touches only its widgets.
 * A control talks to data through a bind: { get(), set(value, live), commit() }. Controls.bindStore(store, path) makes one.
 */
function makeControls() {
  let uidN = 0;
  const uid = (p) => `${p}${++uidN}${Math.random().toString(36).slice(2, 5)}`;
  let reg = [];                                              // refresh functions of the controls built now
  const root = reg;
  const safe = (fn) => { try { fn(); } catch (e) { console.error('Control refresh failed:', e); } };
  /** Adds a control's refresh to the registry. A control whose element left the page is dropped at the next refreshAll. */
  const track = (c) => {
    const fn = () => c.refresh();
    fn.el = c.el;
    reg.push(fn);
    safe(fn);                                                // show the current value at once
    return c;
  };
  function refreshAll() {
    for (let i = root.length - 1; i >= 0; i--) {
      const fn = root[i];
      if (fn.el) {
        if (fn.el.isConnected) fn.seen = true;
        else if (fn.seen) { root.splice(i, 1); continue; }
      }
    }
    root.slice().forEach(safe);
  }

  const bindStore = (store, path) => ({
    get: () => store.get(path),
    set: (v, live = false) => store.set(path, v, { live }),
    commit: () => store.commit(),
  });
  /** A bind with a different stored and shown value: to(stored) -> shown, from(shown) -> stored. */
  const mapBind = (bind, to, from) => ({
    get: () => to(bind.get()),
    set: (v, live) => bind.set(from(v), live),
    commit: () => bind.commit(),
  });
  /** A bind over a plain object key (no undo). */
  const bindObject = (obj, key, onSet) => ({
    get: () => obj[key],
    set: (v) => { obj[key] = v; if (onSet) onSet(v); },
    commit: () => {},
  });

  /**
   * Slider with a number field. Typed values may pass the slider range (only hardMin and hardMax limit them).
   * o: { label, bind, min, max, step, hardMin, hardMax, format, parse, integer, inputMode, compact }
   */
  function slider(o) {
    const id = uid('sl');
    const step = o.step == null ? 1 : o.step;
    const hardMin = o.hardMin == null ? -Infinity : o.hardMin;
    const hardMax = o.hardMax == null ? Infinity : o.hardMax;
    const format = o.format || ((v) => String(v));
    const parse = o.parse || parseNumber;
    const limit = (v) => { v = clamp(v, hardMin, hardMax); return o.integer ? Math.round(v) : v; };
    const compact = !!o.compact;

    const range = compact ? null : h('input', { class: 'range', type: 'range', id, min: o.min, max: o.max, step });
    const field = h('input', { class: 'numfield', type: 'text', id: compact ? id : null, inputmode: o.inputMode || 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `${o.label} value` });
    const el = compact
      ? h('div', { class: 'ctl compact' }, h('label', { class: 'ctl-label', for: id }, o.label), field)
      : h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: id }, o.label), h('div', { class: 'ctl-row' }, range, field));

    function refresh() {
      const v = o.bind.get();
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (range) {
        range.value = clamp(v, o.min, o.max);
        range.style.setProperty('--pf', clamp((v - o.min) / ((o.max - o.min) || 1), 0, 1));
        range.setAttribute('aria-valuetext', format(v));
      }
      if (!(document.activeElement === field && field.dataset.dirty === '1')) field.value = format(v);
    }
    if (range) {
      range.addEventListener('input', () => { o.bind.set(limit(parseFloat(range.value)), true); refresh(); });
      range.addEventListener('change', () => o.bind.commit());
      range.addEventListener('pointerup', () => o.bind.commit());
      range.addEventListener('pointercancel', () => o.bind.commit());
      range.addEventListener('blur', () => o.bind.commit());
    }
    const apply = () => {
      field.dataset.dirty = '';
      const v = parse(field.value);
      if (isFinite(v)) o.bind.set(limit(v), false);
      refresh();
      field.value = format(o.bind.get());
    };
    field.addEventListener('input', () => { field.dataset.dirty = '1'; });
    field.addEventListener('change', apply);
    field.addEventListener('focus', () => setTimeout(() => field.select(), 0));
    field.addEventListener('blur', () => { if (field.dataset.dirty === '1') apply(); else refresh(); });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { apply(); field.blur(); }
      else if (e.key === 'Escape') { field.dataset.dirty = ''; refresh(); field.value = format(o.bind.get()); field.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = o.bind.get();
        if (typeof cur !== 'number') return;
        o.bind.set(limit(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)), false);
        field.dataset.dirty = ''; refresh(); field.value = format(o.bind.get());
      }
    });
    const c = track({ el, refresh });
    return c;
  }
  /** Number field only (slider with compact: true). */
  const number = (o) => slider({ ...o, compact: true });

  /** On/off switch. o: { label, bind } */
  function toggle(o) {
    const btn = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': 'false' },
      h('span', { class: 'toggle-label' }, o.label), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    btn.addEventListener('click', () => { o.bind.set(!o.bind.get(), false); refresh(); });
    const refresh = () => btn.setAttribute('aria-checked', o.bind.get() ? 'true' : 'false');
    const c = track({ el: h('div', { class: 'ctl' }, btn), refresh });
    return c;
  }

  /** Drop-down. o: { label, bind, options: [{ value, label }] } */
  function select(o) {
    const id = uid('se');
    const sel = h('select', { id, class: 'select' }, o.options.map((x) => h('option', { value: x.value }, x.label)));
    sel.addEventListener('change', () => o.bind.set(sel.value, false));
    const refresh = () => { const v = o.bind.get(); if (v != null) sel.value = v; };
    const c = track({ el: h('div', { class: 'ctl select-row' }, h('label', { for: id }, o.label), sel), refresh });
    return c;
  }

  /** Segmented control: one value from a short list. o: { label, bind, options: [{ value, label, icon, title }] } */
  function segmented(o) {
    const wrap = h('div', { class: 'seg seg-fill', role: 'group', 'aria-label': o.label || null });
    const btns = o.options.map((opt) => {
      const b = h('button', { class: 'seg-btn', type: 'button', 'aria-pressed': 'false', 'data-value': String(opt.value), title: opt.title || null },
        opt.icon ? h('span', { class: 'ico-wrap', html: ICONS[opt.icon] || '' }) : null, opt.label);
      b.addEventListener('click', () => { o.bind.set(opt.value, false); refresh(); });
      wrap.append(b);
      return b;
    });
    const refresh = () => {
      const v = o.bind.get();
      btns.forEach((b, i) => { const on = o.options[i].value === v; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); });
    };
    const c = track({ el: h('div', { class: 'ctl' }, o.label ? h('div', { class: 'ctl-label' }, o.label) : null, wrap), refresh });
    return c;
  }

  /** Several toggle buttons for a list of values. o: { label, bind (array), options: [{ value, label }] } */
  function chips(o) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': o.label });
    const btns = o.options.map((opt) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-value': opt.value }, opt.label);
      b.addEventListener('click', () => {
        const cur = new Set(o.bind.get() || []);
        if (cur.has(opt.value)) cur.delete(opt.value); else cur.add(opt.value);
        if (!cur.size) return;                                   // keep at least one
        o.bind.set(o.options.map((x) => x.value).filter((v) => cur.has(v)), false);
        refresh();
      });
      wrap.append(b);
      return b;
    });
    const refresh = () => { const cur = new Set(o.bind.get() || []); btns.forEach((b) => b.setAttribute('aria-pressed', cur.has(b.dataset.value) ? 'true' : 'false')); };
    const c = track({ el: h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, o.label), wrap), refresh });
    return c;
  }

  /** Color swatch. o: { label, bind }. Returns the bare input as el (same as the Tower). */
  function color(o) {
    const input = h('input', { type: 'color', class: 'color', 'aria-label': o.label });
    input.addEventListener('input', () => o.bind.set(input.value, true));
    input.addEventListener('change', () => { o.bind.set(input.value, true); o.bind.commit(); });
    const refresh = () => { const v = o.bind.get(); if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) input.value = v; };
    const c = track({ el: input, refresh });
    return c;
  }

  /** One-line text. o: { label, bind, placeholder, maxLength, inputMode } ; commits on change and Enter. */
  function text(o) {
    const id = uid('tx');
    const input = h('input', { class: 'textfield', type: 'text', id, placeholder: o.placeholder || null, maxlength: o.maxLength || null, inputmode: o.inputMode || null, autocomplete: 'off', spellcheck: 'false' });
    const apply = () => { input.dataset.dirty = ''; o.bind.set(input.value, false); };
    input.addEventListener('input', () => { input.dataset.dirty = '1'; });
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { apply(); input.blur(); }
      else if (e.key === 'Escape') { input.dataset.dirty = ''; refresh(); input.blur(); }
    });
    const refresh = () => { if (document.activeElement === input && input.dataset.dirty === '1') return; const v = o.bind.get(); input.value = v == null ? '' : String(v); };
    const c = track({ el: h('div', { class: 'ctl text-row' }, o.label ? h('label', { class: 'ctl-label', for: id }, o.label) : null, input), refresh });
    return c;
  }

  /** Lines of "x, y". o: { label, bind (array of [x, y]), need (min points), needText, parse (length parser) } */
  function points(o) {
    const id = uid('pt');
    const parseLen = o.parse || parseLength;
    const ta = h('textarea', { class: 'points', id, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', rows: 5, placeholder: '0, 0\n100, 0\n100, 80' });
    const note = h('div', { class: 'points-note' });
    const round = (v) => Math.round(v * 1000) / 1000;
    const toText = (pts) => (Array.isArray(pts) ? pts : []).map((p) => `${round(p[0])}, ${round(p[1])}`).join('\n');
    const need = o.need || 3;
    function parseText(t0) {
      const pts = []; let bad = 0;
      for (const line of t0.split(/\n|;/)) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split(/[,\s]+/).filter(Boolean);
        const x = parseLen(parts[0]), y = parseLen(parts[1]);
        if (parts.length === 2 && isFinite(x) && isFinite(y)) pts.push([x, y]); else bad++;
      }
      return { pts, bad };
    }
    function showNote(pts, bad) {
      const n = (pts || []).length;
      let msg = `${n} point${n === 1 ? '' : 's'}`;
      let isBad = false;
      if (bad) { msg += `, ${bad} line${bad === 1 ? '' : 's'} skipped (use "x, y")`; isBad = true; }
      if (n < need) { msg += `. ${o.needText || `Needs at least ${need} points.`}`; isBad = true; }
      note.textContent = msg; note.classList.toggle('bad', isBad);
    }
    const apply = () => {
      ta.dataset.dirty = '';
      const { pts, bad } = parseText(ta.value);
      o.bind.set(pts, false);
      ta.value = toText(o.bind.get());
      showNote(o.bind.get(), bad);
    };
    ta.addEventListener('input', () => { ta.dataset.dirty = '1'; });
    ta.addEventListener('change', apply);
    ta.addEventListener('blur', () => { if (ta.dataset.dirty === '1') apply(); });
    const refresh = () => {
      if (document.activeElement === ta && ta.dataset.dirty === '1') return;
      const pts = o.bind.get();
      ta.value = toText(pts);
      if (!note.dataset.keep) showNote(pts, 0);
    };
    const c = track({ el: h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: id }, o.label), ta, note), refresh });
    return c;
  }

  /** Shows its children only while pred() is true. */
  function when(pred, kids) {
    const el = h('div', { class: 'when' }, kids.map((k) => (k && k.el) || k));
    const refresh = () => { el.hidden = !pred(); };
    const c = track({ el, refresh });
    return c;
  }

  const group = (kids) => h('div', { class: 'grid2' }, kids);
  const help = (t) => h('p', { class: 'help' }, t);
  const label = (t) => h('div', { class: 'label sub-label' }, t);
  const button = (t, onclick, cls = 'outline sm') => h('button', { class: `btn ${cls}`, type: 'button', onclick }, t);
  /** A row of buttons. items: [{ label, action, cls, icon, title }] or ready elements. */
  const row = (items) => h('div', { class: 'btn-row' }, items.map((it) => (it && it.nodeType) ? it
    : h('button', { class: `btn ${it.cls || 'outline sm'}`, type: 'button', title: it.title || null, onclick: it.action },
      it.icon ? h('span', { class: 'ico-wrap', html: ICONS[it.icon] || '' }) : null, it.label)));

  /** "More" toggle and a hidden area. Returns [button, area] (or [] when there is nothing to show). */
  function moreBlock(more) {
    if (!more || !more.length) return [];
    const area = h('div', { class: 'more', hidden: true }, more);
    const btn = h('button', { class: 'more-btn', type: 'button', 'aria-expanded': 'false', html: `<span>More</span>${CARET_SVG}` });
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      area.hidden = !open;
      btn.firstChild.textContent = open ? 'Less' : 'More';
    });
    return [btn, area];
  }

  /**
   * Editable list of cards. o: { bind (array), title(i, item), render(i) -> { children, more }, make(arr),
   *   addLabel, min, reorder, openDefault(i), empty, swatch(i, item) -> css color or null,
   *   copy (true: a Copy button on each row that inserts a deep copy right after it), copyTip (its tooltip) }
   * Returns { el, refresh, rebuild(), openAt(i), rowAt(i) }.
   */
  function list(o) {
    const host = h('div', { class: 'list' });
    const emptyNote = o.empty ? h('p', { class: 'help' }, o.empty) : null;
    const open = [];
    const addBtn = button(o.addLabel || 'Add', () => {
      const arr = deepClone(o.bind.get() || []);
      arr.push(o.make(arr));
      open[arr.length - 1] = true;
      o.bind.set(arr, false);
      refresh();
    });
    const el = h('div', { class: 'ctl' }, emptyNote, host, h('div', { class: 'add-row' }, addBtn));
    let kids = [], rendered = -1;
    const len = () => (o.bind.get() || []).length;

    function mutate(fn) {
      const arr = deepClone(o.bind.get() || []);
      fn(arr);
      o.bind.set(arr, false);
      refresh();
    }
    function buildItem(i) {
      const part = o.render(i);
      const isOpen = open[i] === undefined ? (o.openDefault ? !!o.openDefault(i) : i === 0) : open[i];
      const title = h('span', { class: 't' });
      const head = h('button', { class: 'item-title', type: 'button', 'aria-expanded': isOpen ? 'true' : 'false', html: CARET_SVG });
      const sw = o.swatch ? h('span', { class: 'sw', 'aria-hidden': 'true' }) : null;
      if (sw) head.append(sw);
      head.append(title);
      const item = h('div', { class: 'item', 'data-open': isOpen ? 'true' : 'false', 'data-index': String(i) });
      head.addEventListener('click', () => {
        const next = item.dataset.open !== 'true';
        item.dataset.open = next ? 'true' : 'false'; open[i] = next;
        head.setAttribute('aria-expanded', next ? 'true' : 'false');
      });
      const mk = (ic, lb, fn) => h('button', { class: 'ibtn', type: 'button', 'aria-label': lb, title: lb, html: ic, onclick: fn });
      const up = mk(ICON_UP, 'Move up', () => { mutate((a) => { [a[i - 1], a[i]] = [a[i], a[i - 1]]; }); [open[i - 1], open[i]] = [open[i], open[i - 1]]; });
      const down = mk(ICON_DOWN, 'Move down', () => { mutate((a) => { [a[i + 1], a[i]] = [a[i], a[i + 1]]; }); [open[i + 1], open[i]] = [open[i], open[i + 1]]; });
      const del = mk(ICON_X, 'Remove', () => { open.splice(i, 1); mutate((a) => { a.splice(i, 1); }); });
      const bar = h('div', { class: 'item-head' }, head);
      if (o.reorder !== false) bar.append(up, down);
      if (o.copy) {
        const cp = mk(ICONS.copy, 'Copy', () => { open.splice(i + 1, 0, true); mutate((a) => { a.splice(i + 1, 0, deepClone(a[i])); }); });
        if (o.copyTip) cp.setAttribute('data-tip', o.copyTip);
        bar.append(cp);
      }
      bar.append(del);
      item.append(bar, h('div', { class: 'item-body' }, (part && part.children) || [], moreBlock(part && part.more)));
      reg.push(() => {
        const arr = o.bind.get() || [];
        title.textContent = arr[i] ? o.title(i, arr[i]) : '';
        if (sw) sw.style.background = (arr[i] && o.swatch(i, arr[i])) || 'transparent';
        up.disabled = i === 0; down.disabled = i >= arr.length - 1;
        del.disabled = arr.length <= (o.min || 0);
      });
      return item;
    }
    function rebuild() {
      host.textContent = '';
      const mine = [];
      const prev = reg; reg = mine;
      try { for (let i = 0; i < len(); i++) host.append(buildItem(i)); } finally { reg = prev; }
      kids = mine; rendered = len();
      kids.forEach(safe);
    }
    function refresh() {
      if (len() !== rendered) rebuild(); else kids.forEach(safe);
      if (emptyNote) emptyNote.hidden = len() > 0;
    }
    /** Opens row i (for example after a pick in the 3D view) and returns its element. */
    function openAt(i) {
      refresh();
      if (!(i >= 0 && i < len())) return null;
      open[i] = true;
      const r = host.children[i];
      if (r) { r.dataset.open = 'true'; const hd = r.querySelector('.item-title'); if (hd) hd.setAttribute('aria-expanded', 'true'); }
      return r || null;
    }
    const ctl = track({ el, refresh });
    ctl.openAt = openAt;
    ctl.rebuild = rebuild;                       // redraw every row (an owner whose rows read paths that moved); open rows stay open
    ctl.rowAt = (i) => host.children[i] || null;
    return ctl;
  }

  /**
   * Accordion section inside a panel, with an optional "More" area.
   * o: { id, title, open, children, more, onToggle, headExtra } -> { el, setOpen, isOpen }
   */
  function section(o) {
    const bodyId = uid('acc');
    const rootEl = h('section', { class: 'acc', 'data-open': 'false' });
    const head = h('button', { class: 'acc-head', type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId, html: CARET_SVG });
    head.append(h('span', null, o.title));
    if (o.headExtra) head.append(o.headExtra);
    rootEl.append(h('h3', { class: 'acc-h' }, head));
    rootEl.append(h('div', { class: 'acc-body', id: bodyId }, o.children || [], moreBlock(o.more)));
    const setOpen = (open) => { rootEl.dataset.open = open ? 'true' : 'false'; head.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    head.addEventListener('click', () => { setOpen(rootEl.dataset.open !== 'true'); if (o.onToggle) o.onToggle(rootEl.dataset.open === 'true'); });
    setOpen(!!o.open);
    rootEl.dataset.section = o.id || '';
    return { el: rootEl, setOpen, isOpen: () => rootEl.dataset.open === 'true' };
  }

  /** Runs fn with a fresh registry and returns the refresh functions it made. */
  function scoped(fn) { const prev = reg; const mine = []; reg = mine; try { fn(); } finally { reg = prev; } return mine; }

  return {
    bindStore, mapBind, bindObject,
    slider, number, toggle, select, segmented, chips, color, text, points, when,
    group, help, label, button, row, list, section,
    refreshAll, scoped, create: makeControls,
  };
}

export const Controls = makeControls();
