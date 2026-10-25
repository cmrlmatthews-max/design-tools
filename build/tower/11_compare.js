/* ==========================================================================
   COMPARE
   Choose 2 to 4 options. One renderer draws each option in its own part of
   the screen (setViewport / setScissor, see Render.enterCompare), one camera
   control moves them all, and a table under the views lists the metrics with
   the best value in each ranked row in bold.
   ========================================================================== */
const Compare = (() => {
  const CURRENT = '__current';
  const MIN = 2, MAX = 4;
  const $ = (id) => document.getElementById(id);
  let active = false, chosen = [], entries = [], version = 0, refreshTimer = null, ro = null;

  const RULE = 'Bold marks the best value in a row. Higher is better for GFA, FAR, and units and keys. Parking spaces are counted apart and never added to units. Other rows are not ranked.';
  const totalUnits = (m) => { const ub = unitBreakdown(m); return ub.hasTotal ? ub.total : null; };      // residential units + hotel keys
  const parkingSpaces = (m) => { const ub = unitBreakdown(m); return ub.spaces.length ? ub.spaces.reduce((a, r) => a + r.count, 0) : null; };
  const ROWS = [
    { label: 'GFA', get: (e) => e.d.metrics.gfa, fmt: Units.formatArea, higher: true },
    { label: 'FAR', get: (e) => (e.d.metrics.hasSite === false ? null : e.d.metrics.far), fmt: (v) => Units.formatRatio(v, 2), higher: true },
    { label: 'Units + keys (estimate)', get: (e) => totalUnits(e.d.metrics), fmt: Units.formatInt, higher: true },
    { label: 'Parking spaces (estimate)', get: (e) => parkingSpaces(e.d.metrics), fmt: Units.formatInt },
    { label: 'Floors', get: (e) => e.d.metrics.floorCount, fmt: Units.formatInt },
    { label: 'Total height', get: (e) => e.d.metrics.totalHeight, fmt: Units.formatFeetInches },
    { label: 'Site coverage', get: (e) => (e.d.metrics.hasSite === false ? null : e.d.metrics.siteCoverage), fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { label: 'Tower plate (avg)', get: (e) => e.d.metrics.plateAvg, fmt: Units.formatArea },
    { label: 'Net area (before core)', get: (e) => e.d.metrics.netArea, fmt: Units.formatArea },
    { label: 'Warnings', get: (e) => e.d.warnings.length, fmt: Units.formatInt },
  ];

  /** Everything that can be compared: the design on screen (if it differs from its saved copy) and the saved options. */
  function candidates() {
    const list = [];
    if (Options.syncDirty()) list.push({ key: CURRENT, name: `${Store.get('name')} (on screen)`, state: () => Store.snapshot() });
    for (const o of Options.list()) list.push({ key: o.id, name: o.name, state: () => o.state });
    return list;
  }

  function buildEntries() {
    const cands = candidates();
    entries = chosen.map((key) => cands.find((c) => c.key === key)).filter(Boolean).map((c) => {
      const state = fillDefaults(c.state());
      state.name = c.name;
      return { key: c.key, name: c.name, state, d: computeDerived(state), uid: `${c.key}#${version}` };
    });
  }

  function renderBar(cands) {
    const bar = $('cmpBar');
    bar.textContent = '';
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Options to compare' });
    for (const c of cands) {
      const on = chosen.includes(c.key);
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), 'data-key': c.key, title: on ? 'Click to remove from the comparison' : 'Click to add to the comparison' }, c.name);
      b.addEventListener('click', () => {
        if (on) { if (chosen.length <= MIN) { Toast.show(`Compare needs at least ${MIN} options.`, 'warn'); return; } select(chosen.filter((k) => k !== c.key)); }
        else { if (chosen.length >= MAX) { Toast.show(`Compare shows at most ${MAX} options.`, 'warn'); return; } select([...chosen, c.key]); }
      });
      chips.append(b);
    }
    bar.append(h('span', { class: 'label' }, 'Compare'), chips, h('button', { class: 'btn outline sm', type: 'button', onclick: () => exit() }, 'Close'));
  }

  function renderTable() {
    const t = $('cmpTable');
    const head = h('tr', null, h('th', { title: RULE }, 'Metric'), entries.map((e) => h('th', { title: e.name }, e.name)));
    const body = ROWS.map((row) => {
      const vals = entries.map((e) => row.get(e));
      const nums = vals.filter((v) => typeof v === 'number' && isFinite(v));
      const best = row.higher && nums.length ? Math.max(...nums) : null;
      const allSame = nums.length > 0 && nums.every((v) => Math.abs(v - nums[0]) < 1e-9);
      return h('tr', null,
        h('td', { title: row.higher ? RULE : null }, row.label),
        vals.map((v) => {
          const isBest = best !== null && !allSame && typeof v === 'number' && Math.abs(v - best) < 1e-9;
          return h('td', { class: isBest ? 'best' : null }, v == null ? '—' : row.fmt(v));
        }));
    });
    t.replaceChildren(h('table', { class: 'cmp' }, h('thead', null, head), h('tbody', null, body)));
  }

  function positionLabels() {
    const host = $('cmpLabels');
    host.textContent = '';
    if (!active) return;
    const cells = Render.cells();
    entries.forEach((e, i) => {
      const c = cells[i];
      if (!c) return;
      host.append(h('div', { class: 'cmp-label', style: `left:${Math.round(c.x + 8)}px;top:${Math.round(c.y + 8)}px;max-width:${Math.max(60, Math.round(c.w - 16))}px` }, e.name));
    });
  }

  const reserve = () => {
    const bar = $('cmpBar'), table = $('cmpTable');
    return { top: bar.offsetTop + bar.offsetHeight + 6, bottom: table.offsetHeight };
  };
  function layoutChanged() {
    $('viewport').style.setProperty('--cmp-table-h', `${$('cmpTable').offsetHeight}px`);
    Render.refreshInsets(false);
    Render.relayout();
    positionLabels();
  }

  function apply(wasActive = false) {
    version++;
    buildEntries();
    renderBar(candidates());
    renderTable();
    Render.enterCompare(entries.map((e) => ({ name: e.name, state: e.state, d: e.d, uid: e.uid })), reserve, { keepView: wasActive });
    layoutChanged();
    markComparing(true);
  }
  /** The Option button shows a highlight while comparing (the Compare item itself lives in the Option menu). */
  function markComparing(on) {
    const b = $('btnOption');
    if (!b) return;
    b.classList.toggle('is-on', on);
    b.dataset.comparing = on ? 'true' : 'false';
    b.title = on ? 'Comparing options. Open the menu to exit.' : 'Option: name, presets, save, compare';
  }
  function select(keys) {
    chosen = keys.slice(0, MAX);
    apply(true);
  }

  /** Start comparing. keys: option ids (or '__current'); default = the design on screen plus the newest saved one. */
  function enter(keys) {
    const cands = candidates();
    if (cands.length < MIN) {
      Toast.show('Compare needs at least 2 options. Save this design, use Duplicate, change the copy, then try again.', 'warn', 6000);
      return false;
    }
    chosen = (keys && keys.length ? keys : cands.slice(0, 2).map((c) => c.key)).filter((k) => cands.some((c) => c.key === k)).slice(0, MAX);
    if (chosen.length < MIN) chosen = cands.slice(0, 2).map((c) => c.key);
    active = true;
    $('compare').hidden = false;
    $('viewport').dataset.compare = 'true';
    if (!ro) { ro = new ResizeObserver(() => { if (active) layoutChanged(); }); ro.observe($('cmpTable')); ro.observe($('cmpBar')); Render.onResize(() => { if (active) positionLabels(); }); }
    apply();
    return true;
  }
  function exit() {
    if (!active) return;
    active = false; entries = []; chosen = [];
    clearTimeout(refreshTimer);
    Render.exitCompare();
    $('compare').hidden = true;
    $('viewport').dataset.compare = 'false';
    $('viewport').style.removeProperty('--cmp-table-h');
    $('cmpLabels').textContent = '';
    markComparing(false);
  }
  function toggle() { if (active) exit(); else enter(); }

  /** While comparing, edits to the design on screen refresh its column and its view. */
  function init() {
    Store.subscribe((s, info) => {
      if (!active || !chosen.includes(CURRENT) || (info && info.live)) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if (active) apply(true); }, 200);
    });
  }

  return { toggle, enter, exit, init, names: () => entries.map((e) => e.name), isActive: () => active, chosen: () => chosen.slice(), table: () => $('cmpTable').innerText };
})();
