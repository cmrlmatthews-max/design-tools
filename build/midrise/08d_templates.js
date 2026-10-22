/* ==========================================================================
   TEMPLATES
   Form tab > Templates > "Choose a template". Nine layouts (src/midrise/presets.js templateState): a small card
   asks for the few numbers that matter, then the template replaces the bars, courts, deck and podium of the design.
   The site, the context, the programs, the parking, the rules, the roof, the targets, the view and the project
   placement stay. One undo step brings the last layout back.
   ========================================================================== */
const Templates = (() => {
  const LEN = 'len', INT = 'int';
  const F = {
    length: { label: 'Bar length', kind: LEN, min: 40, max: 600 },
    depth: { label: 'Bar depth', kind: LEN, min: 30, max: 120 },
    floors: { label: 'Floors', kind: INT, min: 1, max: CONFIG.limits.maxFloors },
    courtW: { label: 'Court width (east-west)', kind: LEN, min: 20, max: 600 },
    courtD: { label: 'Court depth (north-south)', kind: LEN, min: 20, max: 600 },
    deckW: { label: 'Deck width (east-west)', kind: LEN, min: 40, max: 600 },
    deckD: { label: 'Deck depth (north-south)', kind: LEN, min: 40, max: 600 },
    deckLevels: { label: 'Deck levels', kind: INT, min: 1, max: 10 },
  };
  const TYPES = [
    { id: 'garden', name: 'Garden walk-up', note: 'Low bars with stairs, around a green court', fields: ['length', 'depth', 'floors'] },
    { id: 'corridor-garden', name: 'Corridor garden', note: 'Two bars that meet in an L', fields: ['depth', 'floors'] },
    { id: 'bar', name: 'Double-loaded bar', note: 'One bar with a corridor in the middle', fields: ['length', 'depth', 'floors'] },
    { id: 'courtyard-L', name: 'Courtyard L', note: 'Two bars and a court on two sides', fields: ['courtW', 'courtD', 'depth', 'floors'] },
    { id: 'courtyard-U', name: 'Courtyard U', note: 'Three bars around a court open to one side', fields: ['courtW', 'courtD', 'depth', 'floors'] },
    { id: 'courtyard-O', name: 'Courtyard O', note: 'Four bars around a closed court', fields: ['courtW', 'courtD', 'depth', 'floors'] },
    { id: 'courtyard-E', name: 'Courtyard E', note: 'Two courts between three wings', fields: ['courtW', 'courtD', 'depth', 'floors'] },
    { id: 'wrap', name: 'Wrap with deck', note: 'Bars wrapped around a parking deck', fields: ['deckW', 'deckD', 'deckLevels', 'depth', 'floors'] },
    { id: 'podium', name: 'Podium', note: 'A U of bars over a parking podium', fields: ['courtW', 'courtD', 'depth', 'floors'] },
  ];
  const typeById = (id) => TYPES.find((t) => t.id === id) || null;

  /** What each field holds when nothing is chosen (the template's own numbers). */
  function defaultsFor(type) {
    const out = {};
    try {
      const t = PresetsMod.templateState(type);
      const b = t.bars[0];
      out.length = b.length; out.depth = b.depth; out.floors = b.floors;
      if (type.startsWith('courtyard')) { out.courtW = 120; out.courtD = type === 'courtyard-E' ? 210 : 90; }
      if (type === 'podium') { out.courtW = 170; out.courtD = 135; }
      if (type === 'wrap') { out.deckW = t.deck.w; out.deckD = t.deck.d; out.deckLevels = t.deck.levels; }
    } catch (e) { console.error(e); }
    return out;
  }
  const saved = () => (uiPrefs.templates = uiPrefs.templates || {});
  function valuesFor(type) {
    const d = defaultsFor(type), s = saved()[type] || {};
    const out = {};
    for (const k of typeById(type).fields) out[k] = typeof s[k] === 'number' && isFinite(s[k]) ? s[k] : d[k];
    return out;
  }

  /** A rectangular site that is too small for the template grows (never shrinks), so the new layout starts inside the setbacks. */
  function growSite(s) {
    if (s.site.shape !== 'rect') return;          // polygon and Unlimited sites never grow
    const warn = (st) => computeDerived(st).warnings.some((w) => w.id === 'bar-outside-site');
    if (!warn(s)) return;
    const d = computeDerived(s);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of d.plates) for (const poly of p.polygons) for (const q of poly.outer) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
    if (!isFinite(minX)) return;
    const sb = s.site.setbacks, up = (v) => Math.ceil(v / 10) * 10;
    const halfW = Math.max(Math.abs(minX) - sb.left, Math.abs(maxX) - sb.right, 0), halfD = Math.max(Math.abs(minY) - sb.front, Math.abs(maxY) - sb.back, 0);
    s.site.width = Math.max(s.site.width, up(2 * (halfW + Math.max(sb.left, sb.right) + 5)));
    s.site.depth = Math.max(s.site.depth, up(2 * (halfD + Math.max(sb.front, sb.back) + 5)));
  }

  /**
   * Replaces the layout of the design on screen with a template. `options` as templateState. One undo step.
   * Returns the new state, or null when the template could not be built.
   */
  function apply(type, options = {}) {
    if (!typeById(type)) return null;
    let t;
    try { t = PresetsMod.templateState(type, options); } catch (e) {
      console.error(e);
      Toast.show('That template could not be built with these numbers.', 'bad');
      return null;
    }
    const next = deepClone(Store.raw());
    next.bars = t.bars; next.courts = t.courts; next.deck = t.deck; next.podium = t.podium;
    next.type = t.type; next.floors = t.floors; next.surface = t.surface;
    const s = fillDefaults(next);
    growSite(s);
    if (typeof Select !== 'undefined') { Select.cancelHandleDrag(); Select.clear(); }
    if (Render.comparing()) Compare.exit();
    Store.replace(s);
    if (Render.ready()) Render.setView(Render.info().preset || 'axon', true);
    return s;
  }

  /* ---- the menu ---------------------------------------------------------------------------------------- */
  function openMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'templateMenu' });
    const list = () => {
      el.textContent = '';
      el.append(h('div', { class: 'label pop-label' }, 'Choose a template'));
      for (const t of TYPES) {
        el.append(h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id: `tpl-${t.id}`, 'data-template': t.id, onclick: () => card(t) },
          h('span', { class: 'grow' }, t.name, h('small', null, t.note)), h('span', { html: ICONS.chev, class: 'chev-r', style: 'display:contents' })));
      }
      el.append(h('div', { class: 'pop-note' }, 'A template replaces the bars, courts, deck and podium. The site and the programs stay. Undo brings the last layout back.'));
    };
    const card = (t) => {
      el.textContent = '';
      const vals = valuesFor(t.id);
      const inputs = {};
      el.append(h('button', { class: 'pop-item', type: 'button', id: 'tplBack', onclick: list }, h('span', { class: 'grow' }, '‹  Templates')));
      el.append(h('div', { class: 'label pop-label' }, t.name));
      for (const k of t.fields) {
        const f = F[k];
        const input = h('input', { class: 'numfield', type: 'text', id: `tplf-${k}`, 'data-field': k, inputmode: f.kind === INT ? 'numeric' : 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': f.label });
        input.value = f.kind === INT ? Units.formatInt(vals[k]) : Units.formatFeetInches(vals[k]);
        input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        inputs[k] = input;
        el.append(h('div', { class: 'ctl select-row tpl-row' }, h('label', { for: `tplf-${k}` }, f.label), input));
      }
      const read = () => {
        const out = {};
        for (const k of t.fields) {
          const f = F[k];
          let v = f.kind === INT ? Units.parseNumber(inputs[k].value) : Units.parseLength(inputs[k].value);
          if (!isFinite(v)) v = vals[k];
          if (f.kind === INT) v = Math.round(v);
          out[k] = clamp(v, f.min, f.max);
        }
        return out;
      };
      function go() {
        const o = read();
        saved()[t.id] = o;
        saveUiPrefs(uiPrefs);
        Pop.close();
        if (apply(t.id, o)) Toast.show(`Applied ${t.name}. Undo brings the last layout back.`);
      }
      el.append(h('div', { class: 'pop-actions' },
        h('button', { class: 'btn outline', type: 'button', id: 'tplReset', onclick: () => { delete saved()[t.id]; saveUiPrefs(uiPrefs); card(t); } }, 'Reset numbers'),
        h('button', { class: 'btn solid', type: 'button', id: 'tplApply', onclick: go }, 'Apply')));
      const first = el.querySelector('input');
      if (first) setTimeout(() => first.focus(), 0);
    };
    list();
    Pop.open(anchor, el);
  }

  return { openMenu, apply, types: () => TYPES.map((t) => ({ id: t.id, name: t.name, fields: t.fields.slice() })), defaultsFor, valuesFor };
})();
