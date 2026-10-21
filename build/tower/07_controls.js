/* ==========================================================================
   SHARED: controls
   Generic, reusable building blocks. A control talks to data through a
   "bind" object: { get(), set(value, live), commit() }. Store-backed binds
   come from Controls.bindStore().
   Blocks: slider (with number field), compact number field, toggle, select,
   chips, color, points textarea, when(), list() of cards, section().
   ========================================================================== */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const CARET_SVG = '<svg class="caret" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const Controls = (() => {
  let uidN = 0;
  const uid = (p) => `${p}${++uidN}`;
  let reg = [];                                          // the registry new controls add their refresh function to
  const track = (c) => { reg.push(c.refresh); return c; };
  const root = reg;
  const refreshAll = () => root.slice().forEach((fn) => fn());

  const bindStore = (store, path) => ({
    get: () => store.get(path),
    set: (v, live = false) => store.set(path, v, { live }),
    commit: () => store.commit(),
  });
  /** A bind with a different stored/shown value: get(v) -> shown, put(shown) -> stored. */
  const mapBind = (bind, to, from) => ({
    get: () => to(bind.get()),
    set: (v, live) => bind.set(from(v), live),
    commit: () => bind.commit(),
  });

  /**
   * Slider paired with a number field. Typed values may exceed the slider range
   * (they are limited only by hardMin / hardMax). `compact` drops the slider.
   * o: { label, bind, min, max, step, hardMin, hardMax, format, parse, integer, inputMode, compact }
   */
  function slider(o) {
    const id = uid('sl');
    const step = o.step == null ? 1 : o.step;
    const hardMin = o.hardMin == null ? -Infinity : o.hardMin;
    const hardMax = o.hardMax == null ? Infinity : o.hardMax;
    const format = o.format || ((v) => String(v));
    const parse = o.parse || Units.parseNumber;
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
        range.style.setProperty('--pf', clamp((v - o.min) / (o.max - o.min), 0, 1));
        range.setAttribute('aria-valuetext', format(v));
      }
      if (!(document.activeElement === field && field.dataset.dirty === '1')) field.value = format(v);
    }
    if (range) {
      range.addEventListener('input', () => { o.bind.set(limit(parseFloat(range.value)), true); });
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
      if (e.key === 'Enter') { apply(); field.select(); }
      else if (e.key === 'Escape') { field.dataset.dirty = ''; refresh(); field.value = format(o.bind.get()); field.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = o.bind.get();
        if (typeof cur !== 'number') return;
        o.bind.set(limit(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)), false);
        field.dataset.dirty = ''; refresh(); field.value = format(o.bind.get());
      }
    });
    return track({ el, refresh });
  }

  /** On/off switch. o: { label, bind } */
  function toggle(o) {
    const btn = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': 'false' },
      h('span', null, o.label), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    btn.addEventListener('click', () => { o.bind.set(!o.bind.get(), false); });
    const refresh = () => btn.setAttribute('aria-checked', o.bind.get() ? 'true' : 'false');
    return track({ el: h('div', { class: 'ctl' }, btn), refresh });
  }

  /** Drop-down. o: { label, bind, options: [{value,label}] } */
  function select(o) {
    const id = uid('se');
    const sel = h('select', { id }, o.options.map((x) => h('option', { value: x.value }, x.label)));
    sel.addEventListener('change', () => o.bind.set(sel.value, false));
    const refresh = () => { const v = o.bind.get(); if (v != null) sel.value = v; };
    return track({ el: h('div', { class: 'ctl select-row' }, h('label', { for: id }, o.label), sel), refresh });
  }

  /** Several toggle buttons for a list of values. o: { label, bind (array), options:[{value,label}], allIfEmpty } */
  function chips(o) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': o.label });
    const btns = o.options.map((opt) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-value': opt.value }, opt.label);
      b.addEventListener('click', () => {
        const cur = new Set(o.bind.get() || []);
        if (cur.has(opt.value)) cur.delete(opt.value); else cur.add(opt.value);
        if (!cur.size) return;                                   // keep at least one
        o.bind.set(o.options.map((x) => x.value).filter((v) => cur.has(v)), false);
      });
      wrap.append(b);
      return b;
    });
    const refresh = () => { const cur = new Set(o.bind.get() || []); btns.forEach((b) => b.setAttribute('aria-pressed', cur.has(b.dataset.value) ? 'true' : 'false')); };
    return track({ el: h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, o.label), wrap), refresh });
  }

  /** Color swatch. o: { label, bind } */
  function color(o) {
    const input = h('input', { type: 'color', 'aria-label': o.label });
    input.addEventListener('input', () => o.bind.set(input.value, true));
    input.addEventListener('change', () => { o.bind.set(input.value, true); o.bind.commit(); });
    const refresh = () => { const v = o.bind.get(); if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) input.value = v; };
    return track({ el: input, refresh });
  }

  /** Lines of "x,y". o: { label, bind (array of [x,y]), need (min points), needText } */
  function points(o) {
    const id = uid('pt');
    const ta = h('textarea', { class: 'points', id, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', rows: 5, placeholder: '0, 0\n100, 0\n100, 80' });
    const note = h('div', { class: 'points-note' });
    const round = (v) => Math.round(v * 1000) / 1000;
    const toText = (pts) => (Array.isArray(pts) ? pts : []).map((p) => `${round(p[0])}, ${round(p[1])}`).join('\n');
    const need = o.need || 3;
    function parseText(text) {
      const pts = []; let bad = 0;
      for (const line of text.split(/\n|;/)) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split(/[,\s]+/).filter(Boolean);
        const x = Units.parseLength(parts[0]), y = Units.parseLength(parts[1]);
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
    return track({ el: h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: id }, o.label), ta, note), refresh });
  }

  /** Wrapper that shows its children only while pred() is true. */
  function when(pred, kids) {
    const el = h('div', { class: 'when' }, kids.map((k) => k.el || k));
    return track({ el, refresh: () => { el.hidden = !pred(); } });
  }

  const group = (kids) => h('div', { class: 'grid2' }, kids);
  const help = (text) => h('p', { class: 'help' }, text);
  const label = (text) => h('div', { class: 'label sub-label' }, text);
  const button = (text, onclick, cls = 'outline sm') => h('button', { class: `btn ${cls}`, type: 'button', onclick }, text);

  /** "More" toggle + hidden advanced area. Returns [button, area] (or [] when there is nothing to show). */
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
   * Editable list of cards (segments, setbacks, carves, ...).
   * o: { bind (array), title(i, item) -> text, render(i) -> { children, more }, make(arr) -> new item,
   *      addLabel, min, reorder, openDefault(i), empty, swatch(i, item) -> css color or null (a color chip before the title) }
   * Returns { el, refresh, openAt(i) -> the row element (opens it), rowAt(i) }.
   */
  function list(o) {
    const host = h('div', { class: 'list' });
    const emptyNote = o.empty ? h('p', { class: 'help' }, o.empty) : null;
    const addBtn = button(o.addLabel || 'Add', () => {
      const arr = deepClone(o.bind.get() || []);
      arr.push(o.make(arr));
      open[arr.length - 1] = true;
      o.bind.set(arr, false);
    });
    const el = h('div', { class: 'ctl' }, emptyNote, host, h('div', { class: 'add-row' }, addBtn));
    let kids = [], rendered = -1;
    const open = [];
    const len = () => (o.bind.get() || []).length;

    function mutate(fn) {
      const arr = deepClone(o.bind.get() || []);
      fn(arr);
      o.bind.set(arr, false);
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
      const mk = (icon, label, fn) => h('button', { class: 'ibtn', type: 'button', 'aria-label': label, title: label, html: icon, onclick: fn });
      const up = mk(ICON_UP, 'Move up', () => { mutate((a) => { [a[i - 1], a[i]] = [a[i], a[i - 1]]; }); [open[i - 1], open[i]] = [open[i], open[i - 1]]; });
      const down = mk(ICON_DOWN, 'Move down', () => { mutate((a) => { [a[i + 1], a[i]] = [a[i], a[i + 1]]; }); [open[i + 1], open[i]] = [open[i], open[i + 1]]; });
      const del = mk(ICON_X, 'Remove', () => { open.splice(i, 1); mutate((a) => { a.splice(i, 1); }); });
      const bar = h('div', { class: 'item-head' }, head);
      if (o.reorder !== false) bar.append(up, down);
      bar.append(del);
      item.append(bar, h('div', { class: 'item-body' }, part.children || [], moreBlock(part.more)));
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
      kids.forEach((fn) => fn());
    }
    const refresh = () => {
      if (len() !== rendered) rebuild(); else kids.forEach((fn) => fn());
      if (emptyNote) emptyNote.hidden = len() > 0;
    };
    /** Opens row i (for example when something is selected in the 3D view) and returns its element. */
    function openAt(i) {
      refresh();
      if (!(i >= 0 && i < len())) return null;
      open[i] = true;
      const row = host.children[i];
      if (row) { row.dataset.open = 'true'; const hd = row.querySelector('.item-title'); if (hd) hd.setAttribute('aria-expanded', 'true'); }
      return row || null;
    }
    const ctl = track({ el, refresh });
    ctl.openAt = openAt;
    ctl.rowAt = (i) => host.children[i] || null;
    return ctl;
  }

  /**
   * Accordion section with an optional "More" area for advanced controls.
   * o: { id, title, open, children:[el], more:[el], onToggle, headExtra (an element placed at the right of the title) }
   * Returns { el, setOpen, isOpen }.
   */
  function section(o) {
    const bodyId = uid('acc');
    const root = h('section', { class: 'acc', 'data-open': 'false' });
    const head = h('button', { class: 'acc-head', type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId, html: `${CARET_SVG}<span>${o.title}</span>` });
    if (o.headExtra) head.append(o.headExtra);
    root.append(h('h2', { style: 'margin:0' }, head));
    const body = h('div', { class: 'acc-body', id: bodyId }, o.children || [], moreBlock(o.more));
    root.append(body);
    const setOpen = (open) => { root.dataset.open = open ? 'true' : 'false'; head.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    head.addEventListener('click', () => { setOpen(root.dataset.open !== 'true'); if (o.onToggle) o.onToggle(root.dataset.open === 'true'); });
    setOpen(!!o.open);
    root.dataset.section = o.id || '';
    return { el: root, setOpen, isOpen: () => root.dataset.open === 'true' };
  }

  return { bindStore, mapBind, slider, toggle, select, chips, color, points, when, group, help, label, button, list, section, refreshAll, scoped: (fn) => { const prev = reg; const mine = []; reg = mine; try { fn(); } finally { reg = prev; } return mine; } };
})();
