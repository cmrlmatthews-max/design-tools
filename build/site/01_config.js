/* ==========================================================================
   CONFIG, MODULES, HELPERS
   The src/site and src/shared modules are inlined here (see build.py), wrapped
   so their names do not collide. Then small helpers, icons, toast and popover.
   ========================================================================== */
//@@MODULE geo@@
//@@MODULE geocode@@
//@@MODULE pmtiles@@
//@@MODULE mvt@@
//@@MODULE tiff@@
//@@MODULE model@@
//@@MODULE exports@@
//@@MODULE screenshot@@

const CONFIG = {
  sizes: [500, 1000, 1500, 2000, 3000],
  defaultSize: 1000,
  scales: [1, 2, 3, 5],
  contours: [0, 2, 5],            // ft; 0 = off
  recentKey: 'sitemodel.recent.v1',
  recentMax: 8,
  demFtPerPixel: 3,               // about 1 pixel per 3 ft
  demMaxPixels: 1024,
  demMargin: 50,                  // ft around the site square
  zoomCap: { buildings: 14, transportation: 14, base: 13 },
  layers: [
    ['ground', 'Ground'], ['buildings', 'Buildings'], ['roads', 'Roads'],
    ['walks', 'Walks'], ['trees', 'Trees'], ['water', 'Water'],
  ],
  steps: [
    ['address', 'Address'], ['release', 'Overture release'], ['ground', 'Ground'],
    ['buildings', 'Buildings'], ['roads', 'Roads'], ['base', 'Trees and water'],
  ],
};

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rad = THREE.MathUtils.degToRad;
const grouped = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtFt = (v, d = 1) => (Number.isFinite(v) ? `${grouped(v, d)} ft` : '-');

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

const ICONS = {
  map: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Reads and writes that never throw (private mode, blocked storage). */
const Local = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
};

const Toast = (() => {
  function show(message, kind = '', ms = 3600) {
    const host = $('toasts');
    const t = h('div', { class: `toast ${kind}`.trim() }, message);
    t.addEventListener('click', () => t.remove());
    host.append(t);
    while (host.children.length > 4) host.firstChild.remove();
    if (ms > 0) setTimeout(() => t.remove(), ms);
    return t;
  }
  return { show };
})();

const Pop = (() => {
  let cur = null;
  function close() {
    if (!cur) return;
    const c = cur; cur = null;
    c.el.remove();
    document.removeEventListener('pointerdown', c.onDown, true);
    document.removeEventListener('keydown', c.onKey, true);
    c.anchor.setAttribute('aria-expanded', 'false');
  }
  /** Opens `el` under `anchor`. A second call for the same anchor closes it. */
  function open(anchor, el, { align = 'right' } = {}) {
    const same = cur && cur.anchor === anchor;
    close();
    if (same) return false;
    el.classList.add('pop');
    el.style.visibility = 'hidden';
    document.body.append(el);
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth;
    let left = align === 'right' ? r.right - w : r.left;
    left = clamp(left, 8, Math.max(8, window.innerWidth - w - 8));
    const top = Math.min(r.bottom + 6, window.innerHeight - 120);
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    el.style.visibility = '';
    anchor.setAttribute('aria-expanded', 'true');
    const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    cur = { el, anchor, onDown, onKey };
    return true;
  }
  return { open, close };
})();
