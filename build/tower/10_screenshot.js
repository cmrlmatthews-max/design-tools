/* ==========================================================================
   SHARED: screenshot
   src/shared/screenshot.js inlined unchanged (apart from the export keywords),
   plus `Shots`: the image actions and the overlay choices (shown in the Export menu's
   "Image overlay" view). The choices are kept in state.view.shot.
   ========================================================================== */
//@@MODULE screenshot@@

const Shots = (() => {
  const SHOT_ITEMS = [
    ['title', 'Option name'], ['date', 'Date'], ['metrics', 'Six key metrics'], ['mark', 'CMRLM mark'],
  ];
  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

  /** The six metrics on the picture: GFA, FAR, height, floors, units (or coverage), tower plate area. */
  function keyMetrics(d) {
    const m = d.metrics;
    const ub = unitBreakdown(m);      // residential units + hotel keys; parking spaces are not counted
    return [
      ['GFA', Units.formatArea(m.gfa)],
      ['FAR', m.hasSite === false ? '—' : Units.formatRatio(m.far)],
      ['Height', Units.formatFeetInches(m.totalHeight)],
      ['Floors', Units.formatInt(m.floorCount)],
      ub.hasTotal ? [ub.label, Units.formatInt(ub.total)] : ['Site coverage', m.hasSite === false ? '—' : `${(m.siteCoverage * 100).toFixed(1)}%`],
      ['Tower plate (avg)', Units.formatArea(m.plateAvg)],
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

  /** The overlay choices as menu elements (a label and one switch per item). Used by the Export menu's "Image overlay" view. */
  function overlayControls() {
    const out = [h('div', { class: 'label pop-label' }, 'The image shows')];
    for (const [key, text] of SHOT_ITEMS) {
      const btn = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!Store.get(`view.shot.${key}`)), 'data-shot': key, style: 'padding:0 8px' },
        h('span', null, text), h('span', { class: 'switch', 'aria-hidden': 'true' }));
      btn.addEventListener('click', () => {
        const next = !Store.get(`view.shot.${key}`);
        Store.set(`view.shot.${key}`, next, { live: false });
        btn.setAttribute('aria-checked', String(next));
      });
      out.push(btn);
    }
    return out;
  }

  return { take, capture, aiReady, takeAiReady, overlayControls, buildOverlay, keyMetrics };
})();
