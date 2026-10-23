/* ==========================================================================
   SHADOW STUDY SHEET  (docs/tower-project-sun-plan.md sections 4.1 and 6.3)
   `SunStudy` makes the 3 x 3 shadow-range sheet: for each study date (rows) and time (columns), the Plan view with
   shadows, captured with ShotMod.captureView (through Render.capture), laid out on one canvas with labels and the
   CMRLM footer. Downloads <option>-shadow-study.png. Restores the view after.
   While it runs it changes the sun, the shadows switch, the style and the camera as one open drag; at the end every
   value goes back and the drag closes with no net change, so the sheet adds no undo step.
   Shadow strength (batch-fixes plan 3.2): SunUI.sheetMode(true) turns Render.shadowBoost on (a stronger sun, a weaker sky light) for the
   panels, and the flat ground shadow draws at CONFIG.shadowStrength, so the shadows read dark on the sheet. The result also carries the
   sheet canvas and a cell list ({ row, col, x, y, w, h, sun, at(planX, planY) -> sheet pixel }) so a test can read the pixels.
   ========================================================================== */
const SunStudy = (() => {
  let working = false;
  const CELL_W = 560;                 // px: each panel is scaled to this width on the sheet
  const frames = (n) => new Promise((resolve) => {
    let left = n;
    const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(resolve, 400 * n);      // a hidden tab does not run animation frames
  });
  const toBitmap = async (blob) => {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('The panel could not be read.')); im.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  const cssVar = (name, fallback) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch (e) { return fallback; } };

  /** opts { deliver = true }. Resolves to { blob, width, height, panels, rows, cols, filename } (or null when it cannot run). */
  async function make(opts = {}) {
    const deliver = opts.deliver !== false;
    if (working) return null;
    if (!Render.ready()) { Toast.show('The 3D view is not available.', 'bad'); return null; }
    if (Render.comparing()) { Toast.show('Leave Compare to make the shadow study sheet.', 'warn'); return null; }
    working = true;
    SunUI.play(false);
    const sun0 = SunUI.sunState();
    const dates = sun0.dates.slice(0, 3), times = sun0.times.slice(0, 3);
    const st = Store.raw();
    const saved = {
      sun: deepClone(st.sun), viewSun: deepClone(st.view.sun), shadows: st.view.shadows, style: st.view.style,
      preset: Render.info().preset || null, hoursOn: !!(st.sun && st.sun.hours && st.sun.hours.on),
    };
    let sheet = null, sctx = null, cellH = 0, cols = 0;
    const lay = { margin: 36, rowLabel: 92, head: 84, colLabel: 40, foot: 56, gap: 12 };
    const captions = [], cells = [];
    let boostDuring = false;
    try {
      SunUI.sheetMode(true);
      SunLayer.suppress(true);
      // Open the drag with a view.sun write, so the shadow casters stay on while the panels are made.
      const vs = saved.viewSun || { azimuth: 135, altitude: 40 };
      Store.set('view.sun', { azimuth: vs.azimuth, altitude: num(vs.altitude, 40) + 0.5 }, { live: true });
      if (saved.style !== 'model') Store.set('view.style', 'model', { live: true });
      Render.setView('plan', false);
      for (let r = 0; r < dates.length; r++) {
        for (let c = 0; c < times.length; c++) {
          SunUI.setSun({ mode: 'study', date: dates[r], time: times[c] }, { live: true });
          const info = SunUI.calcAt(dates[r], times[c]);
          const up = info.altitude > 0;
          if (!!Store.raw().view.shadows !== up) Store.set('view.shadows', up, { live: true });
          await frames(3);
          boostDuring = boostDuring || Render.shadowBoosted();
          const proj0 = Render.projectPlan(0, 0, 0), projX = Render.projectPlan(100, 0, 0), projY = Render.projectPlan(0, 100, 0);
          const sunNow = deepClone(Store.raw().view.sun);
          const blob = await Render.capture(null, 1);
          const bmp = await toBitmap(blob);
          if (!sheet) {
            cols = times.length;
            cellH = Math.round(CELL_W * bmp.height / bmp.width);
            sheet = document.createElement('canvas');
            sheet.width = lay.margin * 2 + lay.rowLabel + cols * CELL_W + (cols - 1) * lay.gap;
            sheet.height = lay.margin + lay.head + lay.colLabel + dates.length * cellH + (dates.length - 1) * lay.gap + lay.foot + lay.margin / 2;
            sctx = sheet.getContext('2d');
            if (!sctx) throw new Error('Could not create a 2D canvas for the sheet.');
            sctx.fillStyle = '#ffffff';
            sctx.fillRect(0, 0, sheet.width, sheet.height);
          }
          const x = lay.margin + lay.rowLabel + c * (CELL_W + lay.gap);
          const y = lay.margin + lay.head + lay.colLabel + r * (cellH + lay.gap);
          sctx.drawImage(bmp, x, y, CELL_W, cellH);
          if (proj0 && projX && projY) {
            const k = CELL_W / proj0.w;       // sheet pixels per canvas CSS pixel (the panel is the whole canvas)
            cells.push({
              row: r, col: c, x, y, w: CELL_W, h: cellH, up, sun: sunNow,
              at: (px, py) => ({ x: x + (proj0.x + (projX.x - proj0.x) * px / 100 + (projY.x - proj0.x) * py / 100) * k, y: y + (proj0.y + (projX.y - proj0.y) * px / 100 + (projY.y - proj0.y) * py / 100) * k }),
            });
          }
          if (bmp.close) bmp.close();
          sctx.strokeStyle = '#d5d9de'; sctx.lineWidth = 1;
          sctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, cellH - 1);
          captions.push({ x, y, text: up ? `Azimuth ${info.azimuth.toFixed(0)}°   Altitude ${info.altitude.toFixed(0)}°` : 'Sun below the horizon' });
        }
      }
      // labels, captions, header and footer
      const ink = '#1d2530', ink2 = '#5b6572';
      const font = (w, s) => `${w} ${s}px -apple-system, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      sctx.textBaseline = 'alphabetic';
      sctx.fillStyle = ink; sctx.font = font(650, 26); sctx.textAlign = 'left';
      sctx.fillText(`${Store.get('name') || 'Tower'}: shadow study`, lay.margin, lay.margin + 28);
      sctx.fillStyle = ink2; sctx.font = font(400, 15);
      sctx.fillText(`Plan view, north up. ${SunUI.placeText()}. Time zone: ${SunUI.tzText()}.`, lay.margin, lay.margin + 54);
      sctx.font = font(600, 17); sctx.fillStyle = ink; sctx.textAlign = 'center';
      times.forEach((t, c) => sctx.fillText(SunUI.hm(t), lay.margin + lay.rowLabel + c * (CELL_W + lay.gap) + CELL_W / 2, lay.margin + lay.head + 26));
      sctx.textAlign = 'left';
      dates.forEach((md, r) => {
        const y = lay.margin + lay.head + lay.colLabel + r * (cellH + lay.gap) + cellH / 2;
        sctx.fillStyle = ink; sctx.font = font(600, 18);
        sctx.fillText(SunUI.fmtMD(md), lay.margin, y);
        sctx.fillStyle = ink2; sctx.font = font(400, 12.5);
        sctx.fillText(SunUI.dayOffsetText(md), lay.margin, y + 18);
      });
      for (const cp of captions) {
        sctx.font = font(500, 12.5);
        const w = sctx.measureText(cp.text).width + 14;
        sctx.fillStyle = 'rgba(255,255,255,0.82)';
        sctx.fillRect(cp.x + 8, cp.y + 8, w, 22);
        sctx.fillStyle = ink; sctx.fillText(cp.text, cp.x + 15, cp.y + 24);
      }
      const fy = sheet.height - lay.margin / 2 - 18;
      sctx.fillStyle = ink2; sctx.font = font(400, 13); sctx.textAlign = 'left';
      sctx.fillText(`Shadows from the real sun at each date and time${rotationText()}. Generated ${new Date().toISOString().slice(0, 10)}.`, lay.margin, fy);
      sctx.fillStyle = ink; sctx.font = font(700, 16); sctx.textAlign = 'right';
      sctx.fillText('CMRLM', sheet.width - lay.margin, fy);
    } finally {
      // Put everything back. The drag closes with the original values, so the history gets nothing.
      SunUI.sheetMode(false);          // also turns the shadow boost off again (unless the Sun Study mode or a date and time study wants it)
      SunLayer.suppress(false);
      try {
        Store.set('sun', saved.sun === undefined ? { mode: 'manual' } : saved.sun, { live: true });
        Store.set('view.sun', saved.viewSun, { live: true });
        Store.set('view.shadows', saved.shadows, { live: true });
        Store.set('view.style', saved.style, { live: true });
        Store.commit();
        Render.setView(saved.preset || 'axon', false);
        SunUI.syncBoost();
      } catch (e) { console.error(e); }
      working = false;
    }
    const blob = await new Promise((resolve, reject) => sheet.toBlob((b) => (b ? resolve(b) : reject(new Error('The sheet could not be saved as a PNG.'))), 'image/png'));
    const slug = String(Store.get('name') || 'tower').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'tower';
    const filename = `${slug}-shadow-study.png`;
    const out = { blob, width: sheet.width, height: sheet.height, panels: dates.length * times.length, rows: dates.length, cols: times.length, filename, canvas: sheet, cells, boostDuring };
    if (deliver) {
      const result = await ShotMod.deliverImage(blob, filename);
      if (result === 'downloaded') Toast.show('Shadow study sheet saved to your downloads.');
    }
    return out;
  }
  function rotationText() {
    const p = Store.raw().placement;
    const r = p && typeof p === 'object' ? num(p.rotation, 0) : 0;
    return r ? `; the tower is turned ${r}° from true north` : '';
  }
  return { make, busy: () => working };
})();
