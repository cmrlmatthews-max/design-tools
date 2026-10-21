/* ==========================================================================
   AI PROMPTS
   The prompt library (src/tower/prompts.js) is inlined
   below. `Prompts` is the panel: a right-hand drawer on desktop and iPad
   landscape, a full-height sheet on iPad portrait / narrow screens.
   Step 1 saves the AI-ready picture, step 2 copies the filled prompt.
   Custom prompts live in the options storage blob (key `prompts`).
   ========================================================================== */
//@@MODULE prompts@@

const Prompts = (() => {
  const { PROMPT_FIELDS, PROMPTS, fillPrompt } = PromptsMod;
  const GROUPS = [['time', 'Time'], ['material', 'Material'], ['context', 'Context'], ['camera', 'Camera'], ['custom', 'My prompts']];
  const AUTO = [['floors', 'Floors'], ['height', 'Height'], ['program', 'Program'], ['podium', 'Podium'], ['form', 'Form']];
  const FIELD_KEYS = Object.keys(PROMPT_FIELDS);
  const SHAPE_WORDS = { rect: 'rectangular', square: 'rectangular', circle: 'round', ellipse: 'elliptical', triangle: 'triangular', L: 'L-shaped', U: 'U-shaped', polygon: 'custom-shaped' };
  const CROWN_WORDS = { none: 'a flat roof', flat: 'a flat roof', stepped: 'a stepped crown', sloped: 'a sloped crown', spire: 'a spire', screen: 'a rooftop screen' };
  const PROGRAM_WORDS = { residential: 'residential', hotel: 'hotel', office: 'office' };
  const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const TOKEN_HELP = 'Sentence slots: "The facade is {{material}}." · "The setting is {{location}}" · "photographed {{time}}" · ", {{season}}." From your design: {{floors}} {{height}} {{program}} {{podium}} {{form}}. Tick a menu below to let the user choose that slot. The fixed form-lock text is added in front of every prompt.';
  const STARTER = 'Make a photorealistic render of this {{height}} {{program}} tower in {{location}} at {{time}}.';

  /* ---- auto fields, computed from the current option ------------------------------ */
  const articleFor = (phrase) => (/^(?:[aeio]|L-|8|11|18)/i.test(phrase) ? 'an' : 'a');
  const countWord = (n) => (n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
  function tallestSegment(state) {
    let best = null, bestH = -1;
    for (const seg of state.segments || []) {
      const hgt = num(seg.floors, 0) * num(seg.ftf, 0);
      if (hgt > bestH) { best = seg; bestH = hgt; }
    }
    return best;
  }
  const oxford = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

  /** "a rectangular tower with two setbacks, a sky garden and a stepped crown" */
  function formPhrase(state) {
    const seg = tallestSegment(state);
    const shape = SHAPE_WORDS[seg && seg.shape && seg.shape.type] || 'custom-shaped';
    const segs = state.segments || [];
    const mods = [];
    if (segs.some((s) => num(s.twist && s.twist.deg, 0) !== 0)) mods.push('twisting');
    if (segs.some((s) => num(s.taper && s.taper.x, 0) !== 0 || num(s.taper && s.taper.y, 0) !== 0)) mods.push('tapering');
    const lead = mods.length ? `${mods.join(' and ')} ${shape}` : shape;
    const withs = [];
    const nSet = (state.setbacks || []).length;
    if (nSet) withs.push(`${countWord(nSet)} setback${nSet === 1 ? '' : 's'}`);
    if ((state.carves || []).length) withs.push('a sky garden');
    withs.push(CROWN_WORDS[state.crown && state.crown.type] || 'a flat roof');
    return `${articleFor(lead)} ${lead} tower with ${oxford(withs)}`;
  }
  function podiumPhrase(state) {
    if (!state.podium || !state.podium.on) return 'no podium';
    const n = Math.max(1, Math.round(num(state.podium.floors, 1)));
    return `${articleFor(String(n))} ${n}-story podium`;
  }
  /** { floors, height, program, podium, form } for a state and its metrics. */
  function autoValues(state, metrics) {
    const seg = tallestSegment(state);
    return {
      floors: String(metrics.floorCount),
      height: `${Math.round(metrics.totalHeight)} feet`,
      program: PROGRAM_WORDS[seg && seg.program] || 'mixed-use',
      podium: podiumPhrase(state),
      form: formPhrase(state),
    };
  }
  const currentAuto = () => autoValues(Store.raw(), Derived.get().metrics);

  /* ---- prompts and values ---------------------------------------------------------- */
  const prefs = () => (uiPrefs.prompts = uiPrefs.prompts || {});
  const customList = () => Options.storage.listPrompts();
  const allPrompts = () => [...PROMPTS, ...customList()];
  const findPrompt = (id) => allPrompts().find((p) => p.id === id) || null;
  const groupPrompts = (g) => (g === 'custom' ? customList() : PROMPTS.filter((p) => p.group === g));

  /** Menu value: field default, then the prompt's own default, then the user's last pick for THIS prompt (remembered per prompt id). */
  function fieldValue(prompt, key) {
    const f = PROMPT_FIELDS[key];
    const shown = !prompt || (prompt.uses || []).includes(key);       // a choice only counts where the prompt shows that menu
    const remembered = shown && prompt ? ((prefs().fields || {})[prompt.id] || {})[key] : null;
    if (remembered != null && f.options.some((o) => o.value === remembered)) return remembered;
    const d = prompt && prompt.defaults && prompt.defaults[key];
    if (d != null && f.options.some((o) => o.value === d)) return d;
    return f.default != null ? f.default : (f.options[0] || {}).value;
  }
  function rememberField(prompt, key, value) {
    const p = prefs();
    const all = p.fields || {};
    p.fields = { ...all, [prompt.id]: { ...(all[prompt.id] || {}), [key]: value } };
    saveUiPrefs(uiPrefs);
  }
  /** Auto fields plus every pick field (chosen where the prompt shows a menu for it, its default elsewhere). */
  function valuesFor(prompt, overrides) {
    const v = { ...currentAuto() };
    for (const k of FIELD_KEYS) v[k] = fieldValue(prompt, k);
    return { ...v, ...(overrides || {}) };
  }
  const textFor = (prompt, overrides) => fillPrompt(prompt, valuesFor(prompt, overrides));
  const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  /* ---- view state ------------------------------------------------------------------ */
  const ui = { open: false, group: null, editing: null, el: null, restoreFocus: null, raf: 0, busy: false, error: '' };
  const selectedId = (g) => (prefs().selected || {})[g];
  function currentGroup() {
    const g = ui.group || prefs().group;
    return GROUPS.some((x) => x[0] === g) ? g : 'time';
  }
  function currentPrompt() {
    const g = currentGroup(), list = groupPrompts(g);
    return list.find((p) => p.id === selectedId(g)) || list[0] || null;
  }
  function select(group, id) {
    const p = prefs();
    p.group = group;
    p.selected = { ...(p.selected || {}), [group]: id };
    ui.group = group;
    saveUiPrefs(uiPrefs);
  }
  /** The prompt the preview and Copy use: the draft while editing, else the selected one. */
  function activePrompt() {
    if (ui.editing) return { id: ui.editing.id || 'draft', group: 'custom', title: ui.editing.title, template: ui.editing.template, uses: ui.editing.uses, defaults: {} };
    return currentPrompt();
  }
  const activeText = () => { const p = activePrompt(); return p ? textFor(p) : ''; };

  /* ---- notices: inside the panel while it is open (the 3D view's toasts sit beneath it) --------- */
  function notify(message, kind = '') {
    if (!ui.open || !ui.toasts) { Toast.show(message, kind); return; }
    const t = h('div', { class: `toast ${kind}`.trim(), role: 'status' }, message);
    ui.toasts.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ---- clipboard ------------------------------------------------------------------------------ */
  function selectAll(ta, text) {
    try { ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
  }
  async function copyPrompt() {
    const text = activeText();
    if (!text) { notify('Pick a prompt first.', 'warn'); return false; }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        notify('Prompt copied.');
        return true;
      }
    } catch (e) { /* fall back to select + copy */ }
    let ta = ui.preview;
    let temp = false;
    if (!ta || !ta.isConnected || !ui.open) { ta = h('textarea', { readonly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0' }); document.body.append(ta); temp = true; }
    ta.value = text;
    selectAll(ta, text);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (temp) ta.remove();
    if (ok) { notify('Prompt copied.'); return true; }
    if (!temp) selectAll(ta, text);
    notify('Select and copy the text.', 'warn');
    return false;
  }

  async function saveImage() {
    if (ui.busy) return null;
    ui.busy = true; syncSteps();
    try { return await Shots.takeAiReady(); } finally { ui.busy = false; syncSteps(); }
  }

  /* ---- custom prompts -------------------------------------------------------------------------- */
  const uniqueTitle = (title, exceptId) => StorageMod.uniqueName(title, customList().filter((p) => p.id !== exceptId).map((p) => p.title));
  function startNew() {
    ui.error = '';
    ui.editing = { id: null, title: StorageMod.uniqueName('New prompt', customList().map((p) => p.title)), template: STARTER, uses: ['location', 'time'], focus: 'title' };
    ui.group = 'custom';
    render();
  }
  function startEdit(p) {
    ui.error = '';
    ui.editing = { id: p.id, title: p.title, template: p.template, uses: [...(p.uses || [])], focus: 'template' };
    render();
  }
  function duplicateToEdit(p) {
    ui.error = '';
    ui.editing = { id: null, title: StorageMod.uniqueName(`${p.title} (copy)`, customList().map((x) => x.title)), template: p.template, uses: [...(p.uses || [])], focus: 'title' };
    ui.group = 'custom';
    render();
    notify('Copied to My prompts. Change it and press Save.');
  }
  function saveEditing() {
    const e = ui.editing;
    if (!e) return null;
    const title = e.title.trim();
    if (!title) { ui.error = 'Give the prompt a title.'; render(); return null; }
    if (!e.template.trim()) { ui.error = 'Write the prompt text.'; render(); return null; }
    const rec = Options.storage.savePrompt({ id: e.id || undefined, title: uniqueTitle(title, e.id), template: e.template, uses: e.uses.filter((k) => FIELD_KEYS.includes(k)) });
    if (!rec) { ui.error = 'The prompt could not be saved.'; render(); return null; }
    ui.editing = null; ui.error = '';
    select('custom', rec.id);
    render();
    notify('Prompt saved.');
    return rec;
  }
  function cancelEditing() { ui.editing = null; ui.error = ''; render(); }
  async function removePrompt(p) {
    const ok = await confirmDialog(`Delete the prompt “${p.title}”? This cannot be undone.`, 'Delete', true);
    if (!ok) return false;
    Options.storage.removePrompt(p.id);
    render();
    notify('Prompt deleted.');
    return true;
  }

  /* ---- DOM --------------------------------------------------------------------------------------- */
  function build() {
    const back = h('div', { class: 'ai-back', id: 'aiBack', hidden: true });
    back.addEventListener('pointerdown', () => close());
    const closeBtn = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Close AI Prompts', title: 'Close (Esc)', html: ICON_X, onclick: () => close() });
    ui.saveBtn = h('button', { class: 'btn outline step', type: 'button', id: 'aiStepImage', onclick: () => saveImage() }, '1. Save AI-ready image');
    ui.copyBtn = h('button', { class: 'btn solid step', type: 'button', id: 'aiStepCopy', onclick: () => copyPrompt() }, '2. Copy prompt');
    ui.body = h('div', { class: 'ai-body', id: 'aiBody' });
    ui.toasts = h('div', { class: 'ai-toasts', 'aria-live': 'polite' });
    const panel = h('aside', { class: 'ai-panel', id: 'aiPanel', role: 'dialog', 'aria-label': 'AI Prompts', 'aria-modal': 'false', 'data-open': 'false', 'aria-hidden': 'true', tabindex: '-1' },
      h('header', { class: 'ai-head' }, h('h2', null, 'AI Prompts'), closeBtn),
      h('div', { class: 'ai-steps' },
        h('div', { class: 'ai-step-row' }, ui.saveBtn, ui.copyBtn),
        h('p', { class: 'help' }, 'Paste the image and the prompt into ChatGPT or Gemini.')),
      ui.body, ui.toasts);
    document.body.append(back, panel);
    ui.back = back; ui.el = panel;
  }
  function syncSteps() { if (ui.saveBtn) { ui.saveBtn.disabled = ui.busy; ui.saveBtn.textContent = ui.busy ? 'Saving image…' : '1. Save AI-ready image'; } }

  function tabsEl() {
    const g = currentGroup();
    const tabs = h('div', { class: 'ai-tabs', role: 'tablist', 'aria-label': 'Prompt groups' });
    for (const [id, label] of GROUPS) {
      tabs.append(h('button', {
        class: 'ai-tab', type: 'button', role: 'tab', id: `aiTab-${id}`, 'aria-selected': String(id === g), 'data-group': id,
        onclick: () => { if (ui.editing && id !== 'custom') ui.editing = null; ui.group = id; select(id, selectedId(id) || (groupPrompts(id)[0] || {}).id); render(); },
      }, label));
    }
    return tabs;
  }

  function listEl() {
    const g = currentGroup(), list = groupPrompts(g), cur = currentPrompt();
    const wrap = h('div', { class: 'ai-listwrap' });
    if (g === 'custom') {
      wrap.append(h('div', { class: 'ai-listbar' }, h('button', { class: 'btn outline sm', type: 'button', id: 'aiNew', onclick: startNew }, '+ New prompt')));
      if (!list.length && !ui.editing) wrap.append(h('p', { class: 'help ai-empty' }, 'Nothing here yet. Use New prompt, or open any other tab and press Duplicate to edit.'));
    }
    const ul = h('div', { class: 'ai-list', role: 'group', 'aria-label': 'Prompts' });
    for (const p of list) {
      ul.append(h('button', {
        class: 'ai-item', type: 'button', 'aria-pressed': String(ui.editing ? ui.editing.id === p.id : !!cur && cur.id === p.id), 'data-id': p.id,
        onclick: () => { ui.editing = null; select(g, p.id); render(); },
      }, h('span', { class: 'ai-item-title' }, p.title), p.description ? h('span', { class: 'ai-item-desc' }, p.description) : null));
    }
    if (ui.editing && !ui.editing.id) ul.append(h('div', { class: 'ai-item is-draft', 'aria-pressed': 'true' }, h('span', { class: 'ai-item-title' }, ui.editing.title || 'New prompt'), h('span', { class: 'ai-item-desc' }, 'Not saved yet')));
    wrap.append(ul);
    return wrap;
  }

  function fieldsEl(prompt, uses, onPick) {
    const wrap = h('div', { class: 'ai-fields' });
    for (const key of uses) {
      const f = PROMPT_FIELDS[key];
      if (!f) continue;
      const id = `aiField-${key}`;
      const sel = h('select', { id }, f.options.map((o) => h('option', { value: o.value }, o.label)));
      sel.value = fieldValue(prompt, key);
      sel.addEventListener('change', () => { rememberField(prompt, key, sel.value); if (onPick) onPick(); updatePreview(); });
      wrap.append(h('div', { class: 'ctl select-row' }, h('label', { for: id }, f.label), sel));
    }
    return wrap;
  }

  function autoEl() {
    const wrap = h('div', { class: 'ai-auto', id: 'aiAuto' });
    wrap.append(h('div', { class: 'label' }, 'From your design'));
    const chips = h('div', { class: 'ai-chips' });
    ui.chips = {};
    for (const [k, label] of AUTO) {
      const v = h('span', { class: 'v' });
      ui.chips[k] = v;
      chips.append(h('span', { class: `ai-chip${k === 'form' ? ' wide' : ''}`, 'data-auto': k }, h('span', { class: 'k' }, label), v));
    }
    wrap.append(chips);
    return wrap;
  }
  function updateChips() {
    if (!ui.chips) return;
    const a = currentAuto();
    for (const [k] of AUTO) if (ui.chips[k]) ui.chips[k].textContent = a[k];
  }

  function previewEl() {
    const wrap = h('div', { class: 'ai-preview-wrap' });
    ui.preview = h('textarea', { class: 'ai-preview', id: 'aiPreview', readonly: true, rows: '9', 'aria-label': 'Prompt preview', spellcheck: 'false' });
    ui.count = h('span', { class: 'ai-count', id: 'aiCount' });
    wrap.append(h('div', { class: 'sub-title' }, h('span', { class: 'label' }, 'Prompt preview'), ui.count), ui.preview);
    return wrap;
  }
  function updatePreview() {
    if (!ui.preview) return;
    const text = activeText();
    if (ui.preview.value !== text) ui.preview.value = text;
    if (ui.count) ui.count.textContent = `${wordCount(text)} words`;
    ui.copyBtn.disabled = !text;
  }

  function editorEl(refreshFields) {
    const e = ui.editing;
    const wrap = h('div', { class: 'ai-editor' });
    const title = h('input', { type: 'text', id: 'aiEditTitle', maxlength: '60', value: e.title, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Prompt title' });
    title.addEventListener('input', () => { e.title = title.value; updatePreview(); });
    const tpl = h('textarea', { id: 'aiEditTemplate', rows: '8', 'aria-label': 'Prompt text', spellcheck: 'true' });
    tpl.value = e.template;
    tpl.addEventListener('input', () => { e.template = tpl.value; updatePreview(); });
    wrap.append(
      h('div', { class: 'label' }, e.id ? 'Edit prompt' : 'New prompt'),
      h('label', { class: 'ai-lab', for: 'aiEditTitle' }, 'Title'), title,
      h('label', { class: 'ai-lab', for: 'aiEditTemplate' }, 'Prompt text'), tpl,
      h('p', { class: 'points-note', id: 'aiTokenHelp' }, TOKEN_HELP),
      h('div', { class: 'label' }, 'Menus to show'),
    );
    const uses = h('div', { class: 'ai-uses', role: 'group', 'aria-label': 'Menus to show' });
    for (const k of FIELD_KEYS) {
      const cb = h('input', { type: 'checkbox', id: `aiUse-${k}` });
      cb.checked = e.uses.includes(k);
      cb.addEventListener('change', () => { e.uses = FIELD_KEYS.filter((x) => (x === k ? cb.checked : e.uses.includes(x))); refreshFields(); updatePreview(); });
      uses.append(h('label', { class: 'ai-check', for: `aiUse-${k}` }, cb, h('span', null, PROMPT_FIELDS[k].label)));
    }
    wrap.append(uses);
    if (ui.error) wrap.append(h('p', { class: 'points-note bad', role: 'alert' }, ui.error));
    wrap.append(h('div', { class: 'ai-actions' },
      h('button', { class: 'btn outline sm', type: 'button', id: 'aiEditCancel', onclick: cancelEditing }, 'Cancel'),
      h('button', { class: 'btn solid sm', type: 'button', id: 'aiEditSave', onclick: saveEditing }, 'Save prompt')));
    return wrap;
  }

  function detailEl() {
    const wrap = h('div', { class: 'ai-detail' });
    if (ui.editing) {
      const host = h('div', { class: 'ai-fields-host' });
      const refreshFields = () => { host.textContent = ''; host.append(fieldsEl(activePrompt(), ui.editing.uses, null)); };
      wrap.append(editorEl(refreshFields), host, autoEl(), previewEl());
      refreshFields();
      return wrap;
    }
    const p = currentPrompt();
    if (!p) { wrap.append(h('p', { class: 'help' }, 'Select a prompt to see its fields.')); ui.preview = null; ui.chips = null; return wrap; }
    const custom = p.group === 'custom';
    const head = h('div', { class: 'ai-dhead' }, h('div', { class: 'ai-dtitle' }, p.title));
    const desc = p.description ? h('p', { class: 'ai-ddesc', id: 'aiDesc' }, p.description) : null;
    const acts = h('div', { class: 'ai-dacts' });
    if (custom) {
      acts.append(
        h('button', { class: 'btn outline sm', type: 'button', id: 'aiEdit', onclick: () => startEdit(p) }, 'Edit'),
        h('button', { class: 'btn outline sm danger-text', type: 'button', id: 'aiDelete', onclick: () => removePrompt(p) }, 'Delete'));
    } else {
      acts.append(h('button', { class: 'btn outline sm', type: 'button', id: 'aiDuplicate', onclick: () => duplicateToEdit(p) }, 'Duplicate to edit'));
    }
    head.append(acts);
    wrap.append(head);
    if (desc) wrap.append(desc);
    const uses = (p.uses || []).filter((k) => PROMPT_FIELDS[k]);
    if (uses.length) wrap.append(h('div', { class: 'label' }, 'Choose'), fieldsEl(p, uses, null));
    wrap.append(autoEl(), previewEl());
    return wrap;
  }

  function render() {
    if (!ui.el) return;
    const keepScroll = ui.body.scrollTop;
    ui.body.textContent = '';
    ui.body.append(tabsEl(), listEl(), detailEl());
    updateChips();
    updatePreview();
    syncSteps();
    ui.body.scrollTop = keepScroll;
    if (ui.editing && ui.editing.focus) {
      const f = ui.editing.focus; ui.editing.focus = null;
      const el = document.getElementById(f === 'title' ? 'aiEditTitle' : 'aiEditTemplate');
      if (el && ui.open) { try { el.focus({ preventScroll: true }); if (f === 'title') el.select(); } catch (e) { /* ignore */ } }
    }
  }

  /* ---- open / close ------------------------------------------------------------------------------ */
  function open() {
    if (!ui.el) return false;
    if (ui.open) return true;
    Pop.close();
    ui.open = true;
    ui.restoreFocus = document.activeElement;
    render();
    ui.back.hidden = false;
    ui.el.setAttribute('data-open', 'true');
    ui.el.removeAttribute('aria-hidden');
    const btn = document.getElementById('btnAiPrompts');
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-on'); }
    try { ui.el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return true;
  }
  function close() {
    if (!ui.open) return false;
    ui.open = false;
    ui.back.hidden = true;
    ui.el.setAttribute('data-open', 'false');
    ui.el.setAttribute('aria-hidden', 'true');
    ui.toasts.textContent = '';
    const btn = document.getElementById('btnAiPrompts');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-on'); }
    const f = ui.restoreFocus;
    ui.restoreFocus = null;
    if (f && f.focus && document.contains(f)) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    return true;
  }
  const toggle = () => (ui.open ? close() : open());

  function init() {
    build();
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !ui.open) return;
      if (document.querySelector('.modal-back')) return;      // a confirm dialog handles its own Escape
      e.preventDefault();
      close();
    });
    // The numbers in the chips and the preview follow the design while the panel is open.
    Store.subscribe(() => {
      if (!ui.open || ui.raf) return;
      ui.raf = requestAnimationFrame(() => { ui.raf = 0; updateChips(); updatePreview(); });
    });
    Options.onImport(({ promptsAdded }) => { if (promptsAdded && ui.el) render(); });
  }

  return {
    init, open, close, toggle, copyPrompt, saveImage, isOpen: () => ui.open,
    formPhrase, autoValues, podiumPhrase, currentAuto, textFor, findPrompt, allPrompts, valuesFor,
    // the same text the preview shows for a prompt id; `values` overrides auto or pick fields
    promptText: (id, values) => { const p = findPrompt(id); return p ? textFor(p, values) : null; },
    startNew, startEdit, saveEditing, cancelEditing, duplicateToEdit, removePrompt,
    editing: () => (ui.editing ? { ...ui.editing } : null),
    setEditing: (patch) => { if (ui.editing) { Object.assign(ui.editing, patch); render(); } },
    select, render,
  };
})();
