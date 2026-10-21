/* ==========================================================================
   SHARED: screenshot
   src/shared/screenshot.js inlined unchanged (apart from the export keywords),
   plus `Shots`: the tower tool's button and the popover that chooses which
   overlay items appear. The choices are kept in state.view.shot.
   ========================================================================== */
//@@MODULE screenshot@@

const Shots = (() => {
  const SHOT_ITEMS = [
    ['title', 'Option name'], ['date', 'Date'], ['metrics', 'Six key metrics'], ['mark', 'CMRLM mark'],
  ];
  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

  /** The six metrics on the picture: GFA, FAR, height, floors, units (or coverage), efficiency. */
  function keyMetrics(d) {
    const m = d.metrics;
    const ub = unitBreakdown(m);      // residential units + hotel keys; parking spaces are not counted
    return [
      ['GFA', Units.formatArea(m.gfa)],
      ['FAR', Units.formatRatio(m.far)],
      ['Height', Units.formatFeetInches(m.totalHeight)],
      ['Floors', Units.formatInt(m.floorCount)],
      ub.hasTotal ? [ub.label, Units.formatInt(ub.total)] : ['Site coverage', `${(m.siteCoverage * 100).toFixed(1)}%`],
      ['Efficiency', `${(m.efficiencyAvg * 100).toFixed(1)}%`],
    ];
  }

  function buildOverlay() {
    const state = Store.raw(), o = state.view.shot || {};
    const overlay = { theme: prefersDark() ? 'dark' : 'light' };
    const comparing = Render.comparing();
    if (o.title) overlay.title = comparing ? Compare.names().join('  |  ') : state.name;
    if (o.date) overlay.date = true;
    if (o.metrics && !comparing) overlay.metrics = keyMetrics(Derived.get());
    if (o.mark) overlay.mark = 'CMRLM';
    return overlay;
  }

  /** Renders the picture. With deliver = true it also downloads it (or opens the share sheet on an iPad). */
  async function capture({ deliver = false, scale = 2 } = {}) {
    const blob = await Render.capture(buildOverlay(), scale);
    if (deliver) {
      const name = Render.comparing() ? `${Store.get('name')}-compare` : Store.get('name');
      const result = await ShotMod.deliverImage(blob, ShotMod.screenshotFilename(name));
      if (result === 'downloaded') Toast.show('Image saved to your downloads.');
    }
    return blob;
  }
  async function take() {
    try { return await capture({ deliver: true }); } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The image could not be made.', 'bad', 6000); return null; }
  }

  /** The AI-ready picture: no overlay, grid, scale figure or wireframe; Model style; light plain sky. Filename `<option>-ai-ready-YYYY-MM-DD.png`. */
  async function aiReady({ deliver = true, scale = 2 } = {}) {
    const blob = await Render.captureClean(scale);
    if (deliver) {
      const result = await ShotMod.deliverImage(blob, ShotMod.screenshotFilename(`${Store.get('name')}-ai-ready`));
      if (result === 'downloaded') Toast.show('AI-ready image saved to your downloads.');
    }
    return blob;
  }
  async function takeAiReady() {
    try { return await aiReady({ deliver: true }); } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The image could not be made.', 'bad', 6000); return null; }
  }

  function openMenu(anchor) {
    const el = h('div', { role: 'group', 'aria-label': 'Image options' });
    el.append(h('div', { class: 'label pop-label' }, 'The image shows'));
    for (const [key, text] of SHOT_ITEMS) {
      const btn = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!Store.get(`view.shot.${key}`)), style: 'padding:0 8px' },
        h('span', null, text), h('span', { class: 'switch', 'aria-hidden': 'true' }));
      btn.addEventListener('click', () => {
        const next = !Store.get(`view.shot.${key}`);
        Store.set(`view.shot.${key}`, next, { live: false });
        btn.setAttribute('aria-checked', String(next));
      });
      el.append(btn);
    }
    el.append(h('div', { class: 'pop-sep' }));
    el.append(h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id: 'btnAiReady', onclick: () => { Pop.close(); takeAiReady(); } },
      h('span', { class: 'grow' }, 'AI-ready image', h('small', null, 'Plain model, no overlay, grid or wireframe. For ChatGPT or Gemini.'))));
    el.append(h('div', { class: 'pop-actions' }, h('button', { class: 'btn solid', type: 'button', onclick: () => { Pop.close(); take(); } }, 'Save image')));
    Pop.open(anchor, el, { align: 'right' });
  }

  return { take, capture, aiReady, takeAiReady, openMenu, buildOverlay, keyMetrics };
})();
