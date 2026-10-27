/* ==========================================================================
   TOWER: AI prompt library (panel 'tower-prompts')
   Port of build/tower/08b_prompts.js. The prompt text stays in src/tower/prompts.js.
   Step 1 saves the AI-ready picture, step 2 copies the filled prompt. The panel stacks in one column, which also fits the
   iPad bottom sheet. Not ported (Later): the custom-prompt editor and "My prompts".
   ========================================================================== */
import { PROMPT_FIELDS, PROMPTS, fillPrompt, heroFor } from '../../../src/tower/prompts.js';
import { CONFIG, num } from './state.js';

const FIELD_ORDER = ['time', 'material', 'location', 'season'];
const ROW_LABELS = { time: 'Time', material: 'Material', location: 'Context', season: 'Season' };
const AUTO = [['floors', 'Floors'], ['height', 'Height'], ['program', 'Program'], ['podium', 'Podium'], ['form', 'Form']];
const FIELD_KEYS = Object.keys(PROMPT_FIELDS);
const SHAPE_WORDS = { rect: 'rectangular', square: 'rectangular', circle: 'round', ellipse: 'elliptical', triangle: 'triangular', L: 'L-shaped', U: 'U-shaped', polygon: 'custom-shaped' };
const CROWN_WORDS = { none: 'a flat roof', flat: 'a flat roof', stepped: 'a stepped crown', sloped: 'a sloped crown', spire: 'a spire', screen: 'a rooftop screen' };
const PROGRAM_WORDS = { residential: 'residential', hotel: 'hotel', office: 'office' };
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/* ---- auto fields, computed from the current option ---- */
const articleFor = (phrase) => (/^(?:[aeio]|L-|8|11|18)/i.test(phrase) ? 'an' : 'a');
const countWord = (n) => (n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
const oxford = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
function tallestSegment(state) {
  let best = null, bestH = -1;
  for (const seg of state.segments || []) {
    const hgt = num(seg.floors, 0) * num(seg.ftf, 0);
    if (hgt > bestH) { best = seg; bestH = hgt; }
  }
  return best;
}
/** "a rectangular tower with two setbacks, a sky garden and a stepped crown" */
export function formPhrase(state) {
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
export function podiumPhrase(state) {
  if (!state.podium || !state.podium.on) return 'no podium';
  const n = Math.max(1, Math.round(num(state.podium.floors, 1)));
  return `${articleFor(String(n))} ${n}-story podium`;
}
export function autoValues(state, metrics) {
  const seg = tallestSegment(state);
  return {
    floors: String(metrics.floorCount),
    height: `${Math.round(metrics.totalHeight)} feet`,
    program: PROGRAM_WORDS[seg && seg.program] || 'mixed-use',
    podium: podiumPhrase(state),
    form: formPhrase(state),
    hero: heroFor('tower', state, metrics),
    heroColor: CONFIG.heroColorName,
  };
}

const PREFS_KEY = 'cmrlm.tower.prompts';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } };
const writePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* the choices last for this visit */ } };

export function createPrompts(T) {
  const { ctx } = T;
  const { h, Toast } = ctx.ui;
  const prefs = readPrefs();
  const ui = { body: null, preview: null, count: null, chips: null, copyBtn: null, saveBtn: null, busy: false, raf: 0 };
  const save = () => writePrefs(prefs);

  const currentAuto = () => autoValues(T.store.raw(), T.derived.get().metrics);
  const current = () => PROMPTS.find((p) => p.id === prefs.selected) || PROMPTS[0] || null;
  const rowKeys = (uses) => [...FIELD_ORDER.filter((k) => uses.includes(k)), ...uses.filter((k) => !FIELD_ORDER.includes(k))].filter((k) => PROMPT_FIELDS[k]);

  /** Field default, then the prompt's own default, then the last pick for THIS prompt. */
  function fieldValue(prompt, key) {
    const f = PROMPT_FIELDS[key];
    const shown = !prompt || (prompt.uses || []).includes(key);
    const remembered = shown && prompt ? ((prefs.fields || {})[prompt.id] || {})[key] : null;
    if (remembered != null && f.options.some((o) => o.value === remembered)) return remembered;
    const d = prompt && prompt.defaults && prompt.defaults[key];
    if (d != null && f.options.some((o) => o.value === d)) return d;
    return f.default != null ? f.default : (f.options[0] || {}).value;
  }
  function rememberField(prompt, key, value) {
    const all = prefs.fields || {};
    prefs.fields = { ...all, [prompt.id]: { ...(all[prompt.id] || {}), [key]: value } };
    save();
  }
  function valuesFor(prompt, overrides) {
    const v = { ...currentAuto() };
    for (const k of FIELD_KEYS) v[k] = fieldValue(prompt, k);
    return { ...v, ...(overrides || {}) };
  }
  const textFor = (prompt, overrides) => fillPrompt(prompt, valuesFor(prompt, overrides));
  const activeText = () => { const p = current(); return p ? textFor(p) : ''; };
  const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  async function copyPrompt() {
    const text = activeText();
    if (!text) { Toast.show('Pick a prompt first.', { kind: 'warn' }); return false; }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        Toast.show('Prompt copied.');
        return true;
      }
    } catch (e) { /* fall back to select and copy */ }
    const ta = ui.preview && ui.preview.isConnected ? ui.preview : null;
    let ok = false;
    if (ta) { try { ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch (e) { ok = false; } }
    if (ok) { Toast.show('Prompt copied.'); return true; }
    Toast.show('Select and copy the text.', { kind: 'warn' });
    return false;
  }

  function syncSteps() { if (ui.saveBtn) { ui.saveBtn.disabled = ui.busy; ui.saveBtn.textContent = ui.busy ? 'Saving image...' : '1. Save AI-ready image'; } }
  /** Step 1: the AI-ready picture (plain amber model, no overlay, grid or wireframe). */
  async function saveImage() {
    if (ui.busy) return null;
    ui.busy = true; syncSteps();
    try {
      const doc = ctx.project.doc();
      const title = doc ? doc.name : (T.store.get('name') || 'Tower');
      const rows = T.metricRows().slice(0, 6).map((r) => [r.label, r.value]);
      const blob = await ctx.capture.image({ aiReady: true, title, rows, hooks: [(on) => ctx.layers.setAiReady(on)] });
      await ctx.capture.deliver(blob, `${title} ai-ready`);
      return blob;
    } catch (e) {
      console.error(e);
      Toast.show('The image could not be saved.', { kind: 'error' });
      return null;
    } finally { ui.busy = false; syncSteps(); }
  }

  /* ---- DOM ---- */
  function promptRow() {
    const cur = current();
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Prompt', id: 'tower-aiPromptRow' });
    for (const p of PROMPTS) {
      chips.append(h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(!!cur && cur.id === p.id), 'data-id': p.id,
        onclick: () => { prefs.selected = p.id; save(); render(); },
      }, p.title));
    }
    return h('div', { class: 'tower-ai-row' }, h('div', { class: 'label' }, 'Prompt'), chips);
  }
  function fieldsEl(prompt) {
    const wrap = h('div', { class: 'tower-ai-fields' });
    const uses = (prompt.uses || []).filter((k) => PROMPT_FIELDS[k]);
    for (const key of rowKeys(uses)) {
      const f = PROMPT_FIELDS[key];
      const label = ROW_LABELS[key] || f.label;
      const group = h('div', { class: 'chips', role: 'group', 'aria-label': label, id: `tower-aiField-${key}`, 'data-field': key });
      const cur = fieldValue(prompt, key);
      for (const o of f.options) {
        const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(o.value === cur), 'data-value': o.value }, o.label);
        b.addEventListener('click', () => {
          rememberField(prompt, key, o.value);
          for (const x of group.children) x.setAttribute('aria-pressed', String(x === b));
          updatePreview();
        });
        group.append(b);
      }
      wrap.append(h('div', { class: 'tower-ai-row' }, h('div', { class: 'label' }, label), group));
    }
    return wrap;
  }
  function autoEl() {
    const wrap = h('div', { class: 'tower-ai-auto', id: 'tower-aiAuto' }, h('div', { class: 'label' }, 'From your design'));
    const list = h('div', { class: 'tower-ai-chips' });
    ui.chips = {};
    for (const [k, label] of AUTO) {
      const v = h('span', { class: 'v' });
      ui.chips[k] = v;
      list.append(h('span', { class: `tower-ai-chip${k === 'form' ? ' wide' : ''}`, 'data-auto': k }, h('span', { class: 'k' }, label), v));
    }
    wrap.append(list);
    return wrap;
  }
  function previewEl() {
    ui.preview = h('textarea', { class: 'tower-ai-preview', id: 'tower-aiPreview', readonly: true, rows: '9', 'aria-label': 'Prompt preview', spellcheck: 'false' });
    ui.count = h('span', { class: 'help', id: 'tower-aiCount', style: 'margin:0' });
    return h('div', { class: 'tower-ai-preview-wrap' }, h('div', { class: 'tower-ai-row-head' }, h('span', { class: 'label' }, 'Prompt preview'), ui.count), ui.preview);
  }
  function updateChips() {
    if (!ui.chips) return;
    const a = currentAuto();
    for (const [k] of AUTO) if (ui.chips[k]) ui.chips[k].textContent = a[k];
  }
  function updatePreview() {
    if (!ui.preview) return;
    const text = activeText();
    if (ui.preview.value !== text) ui.preview.value = text;
    if (ui.count) ui.count.textContent = `${wordCount(text)} words`;
    if (ui.copyBtn) ui.copyBtn.disabled = !text;
  }
  function render() {
    if (!ui.body || !ui.body.isConnected) return;
    ui.body.textContent = '';
    ui.body.append(promptRow());
    const p = current();
    if (p) {
      if (p.description) ui.body.append(h('p', { class: 'help', id: 'tower-aiDesc' }, p.description));
      if ((p.uses || []).length) ui.body.append(fieldsEl(p));
      ui.body.append(autoEl(), previewEl());
    }
    updateChips(); updatePreview(); syncSteps();
  }

  /** The panel body. */
  function build(body) {
    ui.saveBtn = h('button', { class: 'btn outline', type: 'button', id: 'tower-aiStepImage', onclick: () => saveImage() }, '1. Save AI-ready image');
    ui.copyBtn = h('button', { class: 'btn solid', type: 'button', id: 'tower-aiStepCopy', onclick: () => copyPrompt() }, '2. Copy prompt');
    ui.body = h('div', { class: 'tower-ai-body', id: 'tower-aiBody' });
    body.append(
      h('div', { class: 'tower-ai-steps' }, ui.saveBtn, ui.copyBtn),
      h('p', { class: 'help' }, 'Paste the image and the prompt into ChatGPT or Gemini.'),
      ui.body,
    );
    render();
  }
  /** The numbers in the chips and the preview follow the design. */
  function refresh() {
    if (!ui.body || !ui.body.isConnected || ui.raf) return;
    ui.raf = requestAnimationFrame(() => { ui.raf = 0; updateChips(); updatePreview(); });
  }

  return {
    build, refresh, render, copyPrompt, saveImage, current, textFor, valuesFor, currentAuto,
    promptText: (id, values) => { const p = PROMPTS.find((x) => x.id === id); return p ? textFor(p, values) : null; },
    select: (id) => { if (PROMPTS.some((p) => p.id === id)) { prefs.selected = id; save(); render(); return true; } return false; },
  };
}
