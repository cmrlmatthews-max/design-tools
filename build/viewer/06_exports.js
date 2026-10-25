/* ==========================================================================
   EXPORTS
   Shots: Image and AI-ready image (ShotMod). FileExports: the SketchUp file (ViewerSketchup). Prompts: the AI Prompts panel.
   Every action returns what it made and takes { deliver } so tests can catch the file instead of downloading it.
   ========================================================================== */
const Shots = (() => {
  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  function keyMetrics() {
    const m = Model.hud(), out = [];
    if (m.gfa) out.push(['GFA', m.gfa]);
    if (m.units) out.push(['Units', m.units]);
    if (m.stalls) out.push(['Stalls', m.stalls]);
    if (m.efficiency) out.push(['Efficiency', m.efficiency]);
    if (m.far) out.push(['FAR', m.far]);
    out.push(['Caution', 'Design-stage numbers. No code check.']);
    return out;
  }
  function buildOverlay() {
    return { theme: prefersDark() ? 'dark' : 'light', title: Model.hud().name, date: true, metrics: keyMetrics(), mark: 'CMRLM' };
  }
  async function capture({ deliver = false, scale = 2 } = {}) {
    const blob = await Render.capture(buildOverlay(), scale);
    if (deliver) {
      const result = await ShotMod.deliverImage(blob, ShotMod.screenshotFilename(Model.hud().name));
      if (result === 'downloaded') Toast.show('Image saved to your downloads.');
    }
    return blob;
  }
  async function take() {
    if (!Model.doc()) { Toast.show('Open a project first.', 'warn'); return null; }
    try { return await capture({ deliver: true }); } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The image could not be made.', 'bad', 6000); return null; }
  }
  /** The AI-ready picture: no overlay, grid, marks or selection; a plain light sky; the project building amber, the rest white. */
  async function aiReady({ deliver = true, scale = 2 } = {}) {
    const blob = await Render.captureClean(scale);
    if (deliver) {
      const result = await ShotMod.deliverImage(blob, ShotMod.screenshotFilename(`${Model.hud().name}-ai-ready`));
      if (result === 'downloaded') Toast.show('AI-ready image saved to your downloads.');
    }
    return blob;
  }
  async function takeAiReady() {
    if (!Model.doc()) { Toast.show('Open a project first.', 'warn'); return null; }
    try { return await aiReady({ deliver: true }); } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The image could not be made.', 'bad', 6000); return null; }
  }
  return { take, capture, aiReady, takeAiReady, buildOverlay, keyMetrics };
})();

const FileExports = (() => {
  const save = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: 'display:none' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  /** The SketchUp document for the layers that are on now (the level cut does not change it: it holds the whole project). */
  function sketchupDoc() {
    const doc = Model.doc();
    if (!doc) throw new Error('No project is open.');
    return ViewerSketchup.viewerToSketchup(doc, State.get('layers'), { name: doc.name });
  }
  function sketchup({ deliver } = {}) {
    let d;
    try { d = sketchupDoc(); } catch (e) { console.error(e); Toast.show('The SketchUp file could not be built.', 'bad'); return { ok: false, errors: [String(e && e.message)] }; }
    const v = SkFmt.validateDoc(d);
    if (!v.ok) { console.error(v.errors); Toast.show('The SketchUp file did not pass its own check, so it was not saved.', 'bad'); return { ok: false, errors: v.errors }; }
    if (!v.counts.solid && !v.counts.mesh && !v.counts.lines) { Toast.show('Nothing is on. Turn on a layer first.', 'warn'); return { ok: false, errors: ['empty'] }; }
    const name = SkFmt.sketchupFilename(Model.hud().name);
    const blob = SkFmt.docToBlob(d);
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}. In SketchUp: Extensions > CMRLM > Import Design Tools file.`);
    return { ok: true, filename: name, blob, counts: v.counts };
  }
  return { sketchupDoc, sketchup, save };
})();

/* ---- AI Prompts: pick a prompt, pick the words it uses, copy the text. Pair it with the AI-ready image. ---- */
const Prompts = (() => {
  const { PROMPTS, fillPrompt } = PromptsMod;
  const FIELDS = PromptsMod.PROMPT_FIELDS;
  const GROUPS = [['hero', 'Hero'], ['time', 'Time'], ['material', 'Material'], ['context', 'Context'], ['camera', 'Camera']];
  const ui = { open: false, el: null, back: null, id: PROMPTS[0].id, values: {} };

  /** The words the prompt fills in by itself, from the massing section of the open project. */
  function autoValues() {
    const doc = Model.doc();
    const sec = doc ? ProjectMod.getSection(doc, 'massing') : null;
    const dv = sec && sec.derived && typeof sec.derived === 'object' ? sec.derived : {};
    const levels = Array.isArray(dv.levels) ? dv.levels : [];
    const m = dv.metrics || {};
    const floors = Number.isFinite(m.floors) ? m.floors : levels.length;
    const height = Number.isFinite(m.height) ? m.height : levels.reduce((s, l) => s + (Number.isFinite(l && l.ftf) ? l.ftf : 10), 0);
    const progs = levels.map((l) => (l && typeof l.program === 'string' ? l.program : null)).filter(Boolean);
    const top = progs.length ? progs[progs.length - 1] : null;
    let podium = 0;
    while (podium < progs.length && progs[podium] !== top) podium++;
    if (podium >= progs.length) podium = 0;
    const program = top === 'residential' ? 'residential' : top || 'mixed-use';
    let hero = '';
    try { hero = PromptsMod.heroFor('tower', sec && sec.state, { floorCount: floors, totalHeight: height }); } catch (e) { hero = ''; }
    return {
      form: floors ? `a ${floors}-floor ${program} building` : 'this massing',
      floors: String(floors || 0), height: `${Math.round(height)} feet`, program,
      podium: podium ? `a ${podium}-story podium` : 'no podium',
      hero, heroColor: CONFIG.heroColorName,
    };
  }
  const prompt = () => PROMPTS.find((p) => p.id === ui.id) || PROMPTS[0];
  const fieldValue = (key) => {
    const f = FIELDS[key], v = ui.values[key];
    return v != null && f.options.some((o) => o.value === v) ? v : (f.default != null ? f.default : f.options[0].value);
  };
  function textFor(p, overrides) {
    const values = { ...autoValues() };
    for (const k of Object.keys(FIELDS)) values[k] = fieldValue(k);
    return fillPrompt(p, { ...values, ...(overrides || {}) });
  }
  const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  function render() {
    const el = ui.el;
    el.textContent = '';
    const p = prompt();
    const steps = h('div', { class: 'ai-steps' },
      h('div', { class: 'ai-step-row' },
        h('button', { class: 'btn outline step', type: 'button', id: 'aiStepImage', onclick: () => Shots.takeAiReady() }, '1. Save the AI-ready image'),
        h('button', { class: 'btn solid step', type: 'button', id: 'aiStepCopy', onclick: () => copy() }, '2. Copy the prompt')),
      h('p', { class: 'help' }, 'Paste the image and the prompt into ChatGPT or Gemini. The project building is amber in the image. The prompt says which parts stay as drawn.'));
    const body = h('div', { class: 'ai-body' });
    const chips = h('div', { class: 'chips', id: 'aiPromptChips' });
    for (const [g, label] of GROUPS) {
      const list = PROMPTS.filter((q) => q.group === g);
      if (!list.length) continue;
      const row = h('div', { class: 'ai-row' }, h('span', { class: 'ai-row-label' }, label), h('div', { class: 'chips' }));
      for (const q of list) row.lastChild.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(q.id === ui.id), 'data-prompt': q.id, onclick: () => { ui.id = q.id; render(); } }, q.title));
      body.append(row);
    }
    body.append(h('p', { class: 'ai-ddesc' }, p.description || ''));
    const uses = (p.uses || []).filter((k) => FIELDS[k]);
    const pick = h('div', { class: 'ai-fields' });
    for (const k of uses) {
      const f = FIELDS[k], row = h('div', { class: 'ai-row' }, h('span', { class: 'ai-row-label' }, f.label), h('div', { class: 'chips' }));
      for (const o of f.options) row.lastChild.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(fieldValue(k) === o.value), 'data-field': k, onclick: () => { ui.values[k] = o.value; render(); } }, o.label));
      pick.append(row);
    }
    body.append(pick);
    const text = textFor(p);
    body.append(h('div', { class: 'ai-preview-wrap' }, h('div', { class: 'ai-count', id: 'aiCount' }, `${wordCount(text)} words`),
      h('textarea', { class: 'ai-preview', id: 'aiPreview', readonly: true, 'aria-label': 'The prompt text' }, text)));
    el.append(h('div', { class: 'ai-head' }, h('h2', null, 'AI Prompts'), h('button', { class: 'ibtn', type: 'button', id: 'aiClose', 'aria-label': 'Close AI Prompts', html: ICONS.x, onclick: close })), steps, body);
    $('aiPreview').value = text;
  }
  async function copy() {
    const text = textFor(prompt());
    try { await navigator.clipboard.writeText(text); Toast.show('The prompt is on your clipboard.'); } catch (e) {
      const ta = $('aiPreview'); if (ta) { ta.focus(); ta.select(); }
      try { document.execCommand('copy'); Toast.show('The prompt is on your clipboard.'); } catch (e2) { Toast.show('Select the text and copy it.', 'warn'); }
    }
    return text;
  }
  function open() {
    if (!ui.el) {
      ui.back = h('div', { class: 'ai-back', id: 'aiBack', onclick: close, hidden: true });
      ui.el = h('div', { class: 'ai-panel', id: 'aiPanel', role: 'dialog', 'aria-label': 'AI Prompts', tabindex: '-1' });
      document.body.append(ui.back, ui.el);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.open) close(); });
    }
    render();
    ui.open = true; ui.back.hidden = false; ui.el.dataset.open = 'true';
  }
  function close() { if (!ui.el) return; ui.open = false; ui.back.hidden = true; ui.el.dataset.open = 'false'; }
  return { open, close, toggle: () => (ui.open ? close() : open()), isOpen: () => ui.open, currentAuto: autoValues, promptText: (id, overrides) => { const p = PROMPTS.find((q) => q.id === id); return p ? textFor(p, overrides) : ''; }, allPrompts: () => PROMPTS };
})();
