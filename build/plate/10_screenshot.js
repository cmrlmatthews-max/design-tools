/* ==========================================================================
   SHARED: screenshot
   src/shared/screenshot.js (inlined with the other modules),
   plus `Shots`: the image action and the overlay choices (shown in the Export menu's
   "Image overlay" view). The choices are kept in state.view.shot.
   ========================================================================== */
const Shots = (() => {
  const SHOT_ITEMS = [
    ['title', 'Option name'], ['date', 'Date'], ['metrics', 'Key metrics'], ['mark', 'CMRLM mark'],
  ];
  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

  /** The key metrics on the picture: units (keys), NRSF, efficiency, corridor length, then the test-fit caution. */
  function keyMetrics(d) {
    const m = d.hud, hotel = Store.raw().mode === 'hotel';
    return [
      [hotel ? 'Keys' : 'Units', Units.formatInt(m.units)],
      ['NRSF', Units.formatArea(m.nrsf)],
      ['Efficiency', pct1(m.efficiency)],
      ['Avg unit', Units.formatArea(m.avgUnit)],
      ['Warnings', String(d.warnings.filter((w) => w.level !== 'info').length)],
      ['Caution', 'Test fit only. Not a code check.'],
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

  return { take, capture, overlayControls, buildOverlay, keyMetrics };
})();
