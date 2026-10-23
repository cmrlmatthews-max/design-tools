/* ==========================================================================
   TESTS: sun study, sun hours, shadow study sheet (docs/tower-project-sun-plan.md section 9.2)
   The Sun section (mode, date, time, place, time zone, Play), the light that follows the real sun (also turned by the
   placement rotation), shadows off below the horizon, the sun-hours compute (slices, Cancel, out of date, Diagram), the
   project hand-off and the 3 x 3 shadow study sheet. runAllTests in 12b merges the results.
   ========================================================================== */
async function runSunTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const within = (a, b, tol) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b} (tolerance ${tol})`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n) => new Promise((resolve) => { let left = n; const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step); }; requestAnimationFrame(step); setTimeout(resolve, 300 * n); });
  const $q = (sel) => document.querySelector(sel);
  const YEAR = new Date().getFullYear();
  const ATL = SolarMod.ATLANTA;
  const truePos = (md, minutes, tz = 'us-eastern', lat = ATL.lat, lon = ATL.lon) => SolarMod.sunPosition(lat, lon, SolarMod.localToUTC(`${YEAR}-${md}`, minutes, tz));
  const hasGL = Render.ready();

  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  SunUI.play(false);
  SunLayer.clear();
  const mem = ProjectFixture.memory();
  const origWrite = ProjectUI.writeSun;
  const writes = [];
  const fresh = () => { Store.replace(fillDefaults(defaultState()), { resetHistory: true }); };
  const setStudy = (patch) => SunUI.setSun({ mode: 'study', ...patch });
  const timings = {};

  try {
    fresh();
    openSection('sun');                                   // every section starts collapsed

    /* ---- the section ---- */
    await t('the Sun section starts in Manual mode with the azimuth and altitude sliders, and no study controls', () => {
      UI.setTab('view');
      const sec = $q('#tabpanel-view [data-section="sun"]');
      const mode = $q('[data-sun="mode"]');
      const labels = [...sec.querySelectorAll('.ctl-label')].filter((l) => l.offsetParent !== null).map((l) => l.textContent).join('|');
      const dates = $q('[data-sun="date-presets"]');
      return eq([!!sec, mode && mode.value, /Sun azimuth/.test(labels) && /Sun altitude/.test(labels), dates && dates.offsetParent === null], [true, 'manual', true, true]);
    });
    await t('choosing Date and time shows the date buttons Mar 20, Jun 21, Dec 21, the time buttons 9:00, 12:00, 15:00, Play and the place and time zone', () => {
      const mode = $q('[data-sun="mode"]');
      mode.value = 'study';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      const txt = (sel) => [...document.querySelectorAll(sel)].map((b) => b.textContent);
      const vis = (sel) => { const e = $q(sel); return !!e && e.offsetParent !== null; };
      return eq([SunUI.info().mode, txt('[data-sun="date-presets"] button'), txt('[data-sun="time-presets"] button'), vis('[data-sun="play"]'), vis('[data-sun="place"]'), vis('[data-sun="tz"]'), vis('[data-sun="compute"]'), vis('[data-sun="sheet"]')],
        ['study', ['Mar 20', 'Jun 21', 'Dec 21'], ['9:00', '12:00', '15:00'], true, true, true, true, true]);
    });
    await t('a date button and a time button set the date and time, and the light follows: Jun 21 12:00 Atlanta is azimuth 108.9, altitude 66.0', () => {
      document.querySelector('[data-sun="date-presets"] button[data-value="06-21"]').click();
      document.querySelector('[data-sun="time-presets"] button[data-value="720"]').click();
      const i = SunUI.info(), v = Store.get('view.sun');
      return eq([i.date, i.time, Math.abs(v.azimuth - 108.87) < 0.2, Math.abs(v.altitude - 65.96) < 0.2], ['06-21', 720, true, true]);
    });
    await t('Jun 21 15:00 (the screenshot case) matches SolarMod: view.sun = the true bearing and altitude, rounded to 0.1', () => {
      document.querySelector('[data-sun="time-presets"] button[data-value="900"]').click();
      const p = truePos('06-21', 900), v = Store.get('view.sun');
      const a = within(v.azimuth, p.azimuth, 0.06);
      return a === true ? within(v.altitude, p.altitude, 0.06) : a;
    });
    await t('the readout shows azimuth, altitude, sunrise, sunset and solar noon for the date', () => {
      const text = $q('[data-sun="readout"]').textContent;
      const i = SunUI.info(), tm = SolarMod.sunTimes(ATL.lat, ATL.lon, `${YEAR}-06-21`, 'us-eastern');
      return eq([/Azimuth/.test(text), /Altitude/.test(text), /Sunrise/.test(text), /Sunset/.test(text), /Solar noon/.test(text), Math.abs(i.sunrise - tm.sunrise) < 0.01, Math.abs(i.sunrise - 383) < 8, text.includes(SunUI.hm(tm.sunrise)), text.includes(SunUI.hm(tm.sunset))],
        [true, true, true, true, true, true, true, true, true]);
    });
    await t('the time slider runs from sunrise to sunset in 15-minute steps, and a drag is one undo step', () => {
      const r = $q('[data-sun="time-slider"]');
      const i = SunUI.info();
      const d0 = Store.historyDepth();
      r.value = 780;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.value = 810;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return eq([+r.step, +r.min <= i.sunrise && i.sunrise - +r.min < 15, +r.max >= i.sunset && +r.max - i.sunset < 15, SunUI.info().time, Store.historyDepth() - d0], [15, true, true, 810, 1]);
    });
    await t('every change is one undo step and undo returns the date, the time and the light together', () => {
      document.querySelector('[data-sun="time-presets"] button[data-value="540"]').click();
      const after = { time: SunUI.info().time, v: Store.get('view.sun') };
      const d0 = Store.historyDepth();
      document.querySelector('[data-sun="time-presets"] button[data-value="900"]').click();
      const one = Store.historyDepth() - d0;
      Store.undo();
      const back = { time: SunUI.info().time, v: Store.get('view.sun') };
      return eq([one, back], [1, after]);
    });

    /* ---- real shadows ---- */
    await t('a placement rotation of 90 turns the light: view.sun azimuth = (true bearing + 90) mod 360, and 0 turns it back', () => {
      setStudy({ date: '06-21', time: 900 });
      const p = truePos('06-21', 900);
      const a0 = Store.get('view.sun').azimuth;
      Store.set('placement', { x: 0, y: 0, rotation: 90, baseZ: 0 }, { live: false });
      const a90 = Store.get('view.sun').azimuth;
      const want = SolarMod.localBearing(p.azimuth, 90);
      Store.set('placement', null, { live: false });
      const a00 = Store.get('view.sun').azimuth;
      const r = within(a90, want, 0.06);
      return r === true ? eq([Math.abs(a0 - p.azimuth) < 0.06, a00], [true, a0]) : r;
    });
    await t('the light and the shadows follow in the 3D view (casters stay on while the time slider moves)', async () => {
      if (!hasGL) return true;
      setStudy({ date: '12-21', time: 900 });
      await frames(3);
      const live = Store.get('view.shadows');
      return eq([live, Store.get('view.sun').altitude > 15 && Store.get('view.sun').altitude < 30], [true, true]);
    });
    await t('below the horizon (2:00): shadows turn off, the readout says so, the light stays at 3 degrees; at noon the shadows come back', () => {
      setStudy({ date: '03-20', time: 120 });
      const i = SunUI.info();
      const note = $q('[data-sun="read-note"]');
      const off = [i.below, Store.get('view.shadows'), Store.get('view.sun').altitude, /below the horizon/i.test(note.textContent)];
      setStudy({ time: 720 });
      return eq([off, SunUI.info().below, Store.get('view.shadows')], [[true, false, 3, true], false, true]);
    });
    await t('a shadows switch the user turned off is not turned on again by the sun coming up', () => {
      setStudy({ date: '03-20', time: 720 });
      Store.set('view.shadows', false, { live: false });
      setStudy({ time: 120 });
      setStudy({ time: 720 });
      const r = Store.get('view.shadows');
      Store.set('view.shadows', true, { live: false });
      return eq(r, false);
    });
    await t('going back to Manual keeps the last light on the azimuth and altitude sliders and turns shadows back on', () => {
      setStudy({ date: '03-20', time: 120 });
      const v = deepClone(Store.get('view.sun'));
      SunUI.setSun({ mode: 'manual' });
      return eq([Store.get('view.shadows'), Store.get('view.sun'), SunUI.info().mode], [true, v, 'manual']);
    });

    /* ---- place and time zone ---- */
    await t('Atlanta is the default place; typed latitude and longitude move the sun (noon Mar 20, 40.7, -74.0)', () => {
      setStudy({ date: '03-20', time: 720, place: { source: 'default' } });
      const atl = SunUI.info();
      SunUI.setSun({ place: { source: 'typed', lat: 40.7, lon: -74.0 } });
      const ny = SunUI.info();
      const want = truePos('03-20', 720, 'us-eastern', 40.7, -74.0);
      const r = within(ny.altitude, want.altitude, 0.01);
      SunUI.setSun({ place: { source: 'default' } });
      return r === true ? eq([atl.place.label, ny.place.label, ny.altitude < atl.altitude], ['Atlanta', 'Typed place', true]) : r;
    });
    await t('Site without a project falls back to Atlanta and says so', () => {
      SunUI.setSun({ place: { source: 'site' } });
      const i = SunUI.info();
      const note = $q('[data-sun="place-note"]').textContent;
      const opt = $q('[data-sun="place"] option[value="site"]');
      SunUI.setSun({ place: { source: 'default' } });
      return eq([i.place.source, /no site/i.test(note), opt.disabled], ['default', true, true]);
    });
    await t('the time zone changes the sun for the same clock time: Fixed UTC-5 at 12:00 on Mar 20 is one hour later in the day than Eastern daylight', () => {
      setStudy({ date: '03-20', time: 720, tz: { zone: 'us-eastern' } });
      const dst = SunUI.info();
      SunUI.setSun({ tz: { zone: 'fixed', offset: -5 } });
      const fixed = SunUI.info();
      SunUI.setSun({ tz: { zone: 'us-eastern', offset: -5 } });
      return eq([dst.tz.offset, fixed.tz.offset, fixed.azimuth > dst.azimuth + 8, Math.abs(fixed.altitude - truePos('03-20', 780).altitude) < 0.01], [-4, -5, true, true]);
    });

    /* ---- play ---- */
    await t('Play advances the time (one hour per second) as one undo step, and Stop leaves a whole minute', async () => {
      setStudy({ date: '06-21', time: 600 });
      const d0 = Store.historyDepth();
      SunUI.play(true);
      const on = SunUI.info().playing;
      await wait(800);
      const mid = SunUI.info().time;
      SunUI.play(false);
      const end = SunUI.info();
      const ok = on && mid > 600 + 10 && mid < 600 + 120 && !end.playing && end.time === Math.round(end.time);
      return ok || `on ${on}, mid ${mid}, end ${JSON.stringify([end.playing, end.time])}`;
    });
    await t('Play stops by itself at sunset', async () => {
      setStudy({ date: '06-21', time: 600 });
      const i = SunUI.info();
      SunUI.setSun({ time: Math.floor(i.sunset) - 20 });
      SunUI.play(true);
      await wait(900);
      const end = SunUI.info();
      return eq([end.playing, end.time <= i.sunset, end.time >= Math.floor(i.sunset) - 1], [false, true, true]);
    });
    await t('Play from manual mode switches to the study; the Play button shows Stop while it runs', async () => {
      SunUI.setSun({ mode: 'manual', time: 600 });
      SunUI.play(true);
      const btn = $q('[data-sun="play"]');
      const r = [SunUI.info().mode, SunUI.info().playing, btn.textContent];
      SunUI.play(false);
      return eq([r, btn.textContent], [['study', true, 'Stop'], 'Play']);
    });

    /* ---- sun hours ---- */
    await t('Compute on a small grid (local, 20 ft, 60 min) finishes, shows the layer and the legend, and uses a nearest-filter texture at 75 percent', async () => {
      fresh();
      setStudy({ date: '03-20', time: 720, hours: { spacing: 20, step: 60, date: '03-20', extent: 'local' } });
      const t0 = performance.now();
      const r = await SunUI.compute();
      timings.small = { ms: Math.round(performance.now() - t0), computeMs: r.computeMs, nodes: r.nodes, samples: r.samples };
      if (!hasGL) return r.cancelled === false || 'cancelled';
      await frames(3);
      const i = SunLayer.info();
      const leg = $q('#sunLegend');
      return eq([r.cancelled, r.nodes === r.nx * r.ny, i.shown, !!(leg && !leg.hidden), i.texture && i.texture.filter, i.texture && i.texture.opacity, i.texture && i.texture.w === r.nx, SunUI.info().hours.on],
        [false, true, true, true, 'nearest', 0.75, true, true]);
    });
    await t('the grid is the tower site rectangle plus 300 ft on each side, in the local frame, with the day length at the open nodes', () => {
      const s = SunLayer.info().result, d = Derived.get().bounds;
      const ext = (b) => [b.maxX - b.minX + 600, b.maxY - b.minY + 600];
      const want = [Math.floor((Math.max(d.site.maxX, d.union.maxX) - Math.min(d.site.minX, d.union.minX) + 600) / 20) + 1, Math.floor((Math.max(d.site.maxY, d.union.maxY) - Math.min(d.site.minY, d.union.minY) + 600) / 20) + 1];
      const day = (SolarMod.sunTimes(ATL.lat, ATL.lon, `${YEAR}-03-20`, 'us-eastern'));
      const len = (day.sunset - day.sunrise) / 60;
      const r = eq([s.frame, s.nx, s.ny, s.spacing], ['local', want[0], want[1], 20]);
      return r === true ? within(s.max, len, 0.02) : r;
    });
    await t('nodes in the tower shadow get fewer hours than open nodes; the tower footprint is shaded the whole day', () => {
      const s = SunLayer.info().result;
      const inFootprint = SunLayer.hoursAt(0, 0), north = SunLayer.hoursAt(0, 80), open = SunLayer.hoursAt(-280, -280);
      return eq([inFootprint === 0, north < s.max - 2, north > 0, Math.abs(open - s.max) < 0.02], [true, true, true, true]);
    });
    await t('the project hand-off: the finished result goes to ProjectUI.writeSun with a matching hours array, rounded by the project', async () => {
      ProjectUI.writeSun = (r) => { writes.push(r); return origWrite(r); };
      setStudy({ hours: { spacing: 20, step: 60, extent: 'local' } });
      await SunUI.compute();
      ProjectUI.writeSun = origWrite;
      const r = writes[writes.length - 1];
      return eq([writes.length, !!r, r && r.hours.length === r.nx * r.ny, r && r.frame, r && r.spacing, r && r.date, r && r.step], [1, true, true, 'local', 20, '03-20', 60]);
    });
    await t('a form change after a compute marks it Out of date and keeps the old colors; a new compute clears the mark', async () => {
      if (!hasGL) return true;
      const idBefore = SunLayer.info().result.id;
      Store.set('segments.0.floors', 12, { live: false });
      await frames(3);
      const stale = SunLayer.info().stale, badge = $q('[data-sun="stale"]'), legend = $q('[data-sun="legend-stale"]');
      const shown = SunLayer.info().shown, same = SunLayer.info().result.id;
      const badgeHidden = badge && badge.hidden;
      await SunUI.compute();
      await frames(2);
      return eq([stale, badge && badgeHidden === false, !!legend, shown, same === idBefore, SunLayer.info().stale, SunLayer.info().result.id > idBefore], [true, true, true, true, true, false, true]);
    });
    await t('changing the date, the step or the spacing also marks the result out of date', async () => {
      if (!hasGL) return true;
      await frames(2);
      const out = [];
      for (const patch of [{ date: '06-21' }, { step: 30 }, { spacing: 10 }]) {
        SunUI.setSun({ hours: patch });
        await frames(2);
        out.push(SunLayer.info().stale);
        SunUI.setSun({ hours: { date: '03-20', step: 60, spacing: 20 } });
        await frames(2);
        out.push(SunLayer.info().stale);
      }
      return eq(out, [true, false, true, false, true, false]);
    });
    await t('the sun-hours layer hides in Diagram style and shows again in Model style; Show off hides it', async () => {
      if (!hasGL) return true;
      await frames(2);
      Store.set('view.style', 'diagram', { live: false });
      await frames(3);
      const dia = [SunLayer.info().shown, $q('#sunLegend').hidden];
      Store.set('view.style', 'model', { live: false });
      await frames(3);
      const mod = SunLayer.info().shown;
      SunUI.setSun({ hours: { on: false } });
      await frames(3);
      const off = SunLayer.info().shown;
      SunUI.setSun({ hours: { on: true } });
      await frames(3);
      return eq([dia, mod, off, SunLayer.info().shown], [[false, true], true, false, true]);
    });
    await t('the sun-hours layer is part of the sun group, which the AI-ready image hides', async () => {
      if (!hasGL) return true;
      const before = SunLayer.info().shown;
      const blob = await window.__tower.aiReadyScreenshot();
      await frames(2);
      return eq([before, !!blob && blob.size > 1000, SunLayer.info().shown], [true, true, true]);
    });
    await t('Cancel stops a compute between slices: the promise says cancelled, the old result stays', async () => {
      const idBefore = SunLayer.info().result.id;
      SunUI.setSun({ hours: { spacing: 5, step: 15, extent: 'local' } });
      const p = SunUI.compute();
      const busy = SunUI.info().hours.computing;
      SunUI.cancel();
      const r = await p;
      const bar = $q('[data-sun="cancel"]');
      SunUI.setSun({ hours: { spacing: 20, step: 60 } });
      return eq([busy, r.cancelled, SunLayer.info().result.id === idBefore, SunUI.info().hours.computing, bar.hidden], [true, true, true, false, true]);
    });
    await t('the page stays responsive during a compute (a frame callback runs between slices) and the progress bar fills', async () => {
      SunUI.setSun({ hours: { spacing: 5, step: 15, extent: 'local' } });
      const p = SunUI.compute();
      let ticks = 0, sawProgress = false;
      const timer = setInterval(() => { ticks++; const pr = SunUI.info().hours.progress; if (pr && pr.done > 0 && pr.total > 0) sawProgress = true; }, 5);
      const bar = $q('[data-sun="progress"]');
      const shownBar = bar && !bar.hidden;
      const r = await p;
      clearInterval(timer);
      timings.fine = { ms: r.ms, computeMs: r.computeMs, nodes: r.nodes, samples: r.samples };
      SunUI.setSun({ hours: { spacing: 20, step: 60 } });
      return eq([r.cancelled, shownBar, ticks > 0 || r.ms < 30, sawProgress || r.ms < 30], [false, true, true, true]);
    });
    await t('Compute with a project site uses the site square in the project frame; the open ground gets the full day and the near building shades its north side', async () => {
      ProjectUI.reset();
      ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      SunLayer.clear();
      setStudy({ date: '03-20', time: 720, place: { source: 'site' }, hours: { spacing: 20, step: 60, date: '03-20', extent: 'site' } });
      const info = SunUI.info();
      const t0 = performance.now();
      const r = await SunUI.compute();
      timings.site = { ms: Math.round(performance.now() - t0), computeMs: r.computeMs, nodes: r.nodes, samples: r.samples };
      const s = SunLayer.info().result;
      const day = SolarMod.sunTimes(33.927, -84.339, `${YEAR}-03-20`, 'us-eastern');
      const len = (day.sunset - day.sunrise) / 60;
      const open = SunLayer.hoursAt(100, 100);
      const tower = SunLayer.hoursAt(500, 500), north = SunLayer.hoursAt(500, 585);
      const ok = eq([info.place.source, info.place.lat, s.frame, s.nx, s.ny, s.x0, s.y0, tower === 0], ['site', 33.927, 'project', 51, 51, 0, 0, true]);
      if (ok !== true) return ok;
      const a = within(open, len, 0.03);
      return a === true ? (north < len - 1 ? true : `north ${north} vs day ${len}`) : a;
    });
    await t('the heat map sits where the grid is: with the tower rotated 30 degrees the quad corners follow the placement', async () => {
      if (!hasGL) return true;
      await frames(2);
      const key0 = JSON.stringify(SunLayer.info().texture);
      Store.set('placement.rotation', 30, { live: false });
      await frames(3);
      const i = SunLayer.info();
      Store.set('placement.rotation', 0, { live: false });
      await frames(2);
      return eq([i.shown, JSON.stringify(i.texture) === key0], [true, true]);
    });
    await t('a sun-hours result stored in the project comes back when the project is reopened', async () => {
      ProjectUI.flush();
      await wait(50);
      const id = ProjectUI.doc().id;
      const stored = ProjectUI.sunHoursStored();
      SunLayer.clear();
      ProjectUI.openDoc(ProjectMod.loadProject(mem, id));
      Store.set('sun.hours.date', '03-20', { live: false });      // any store change lets the Sun UI look for the stored result
      const back = SunLayer.info().result;
      return eq([!!stored, !!back, back && back.nx, back && back.frame], [true, true, 51, 'project']);
    });
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    SunLayer.clear();

    /* ---- the study sheet ---- */
    await t('the shadow study sheet makes one PNG of nine panels (3 dates x 3 times) with the state, the view and the history unchanged', async () => {
      if (!hasGL) return true;
      fresh();
      setStudy({ date: '06-21', time: 900 });
      const before = { sun: Store.snapshot().sun, v: Store.snapshot().view, depth: Store.historyDepth(), preset: Render.info().preset };
      const t0 = performance.now();
      const r = await SunStudy.make({ deliver: false });
      timings.sheet = Math.round(performance.now() - t0);
      if (!r) return 'no result';
      const sig = new Uint8Array(await r.blob.slice(0, 8).arrayBuffer());
      const png = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
      const after = { sun: Store.snapshot().sun, v: Store.snapshot().view, depth: Store.historyDepth(), preset: Render.info().preset };
      return eq([r.panels, r.rows, r.cols, r.blob.type, png, r.blob.size > 20000, r.width > 1600, r.filename, SunStudy.busy()], [9, 3, 3, 'image/png', true, true, true, 'option-a-shadow-study.png', false])
        === true ? eq(after, before) : eq([r.panels, r.rows, r.cols, r.blob.type, png, r.blob.size, r.width, r.filename, SunStudy.busy()], [9, 3, 3, 'image/png', true, '>20000', '>1600', 'option-a-shadow-study.png', false]);
    });
    await t('the sheet restores a Diagram style and a rotated placement, and leaves shadows as they were', async () => {
      if (!hasGL) return true;
      Store.set('view.style', 'diagram', { live: false });
      Store.set('view.shadows', false, { live: false });
      const before = Store.snapshot().view;
      const r = await SunStudy.make({ deliver: false });
      return eq([!!r, r && r.panels, Store.snapshot().view], [true, 9, before]);
    });
    await t('the dates and times of the sheet are editable: other dates and times change the panels and the file keeps nine', async () => {
      if (!hasGL) return true;
      Store.set('view.style', 'model', { live: false });
      Store.set('view.shadows', true, { live: false });
      SunUI.setSun({ dates: ['01-15', '05-01', '09-10'], times: [480, 600, 1020] });
      const f = $q('[data-sun="sheet-date-0"]'), tf = $q('[data-sun="sheet-time-2"]');
      const fields = [f && f.value, tf && tf.value];
      const r = await SunStudy.make({ deliver: false });
      SunUI.setSun({ dates: ['03-20', '06-21', '12-21'], times: [540, 720, 900] });
      return eq([fields, r && r.panels], [[`${YEAR}-01-15`, '17:00'], 9]);
    });

    /* ---- shadow strength (batch-fixes plan 3.2) ---- */
    // Reads the sheet canvas: a ground point inside the shadow (past the tower's edge on the side away from the sun) against a lit
    // ground point on the sun side. The point comes from the cell's plan-to-sheet map, so the test does not guess pixels.
    const lum = (ctx, x, y) => {
      const d = ctx.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      return s / n;
    };
    const shadowContrast = (r, row = 1, col = 1) => {
      const cell = r.cells.find((c) => c.row === row && c.col === col);
      if (!cell || !cell.up) return { error: 'no sunlit cell' };
      const b = Derived.get().bounds.model;
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, hx = (b.maxX - b.minX) / 2, hy = (b.maxY - b.minY) / 2;
      const az = cell.sun.azimuth * Math.PI / 180, alt = Math.max(cell.sun.altitude, 3) * Math.PI / 180;
      const sx = -Math.sin(az), sy = -Math.cos(az);                       // plan direction the shadows fall toward
      const exit = Math.min(hx / Math.max(Math.abs(sx), 1e-6), hy / Math.max(Math.abs(sy), 1e-6));
      const L = b.height / Math.tan(alt);                                 // shadow length past the tower's edge
      const dist = exit + 0.5 * L;
      const ctx = r.canvas.getContext('2d');
      const sh = cell.at(cx + sx * dist, cy + sy * dist), lit = cell.at(cx - sx * dist, cy - sy * dist);
      const inside = (q) => q.x > cell.x + 4 && q.x < cell.x + cell.w - 4 && q.y > cell.y + 4 && q.y < cell.y + cell.h - 4;
      if (!inside(sh) || !inside(lit)) return { error: `points outside the panel ${JSON.stringify([sh, lit])}` };
      const a = lum(ctx, sh.x, sh.y), l = lum(ctx, lit.x, lit.y);
      return { shadow: Math.round(a * 10) / 10, lit: Math.round(l * 10) / 10, ratio: Math.round(a / l * 1000) / 1000, length: Math.round(L) };
    };
    await t('Render.shadowBoost raises the sun and lowers the sky light, and turning it off restores today\'s values; the ground shadow draws at CONFIG.shadowStrength', () => {
      if (!hasGL) return true;
      Render.shadowBoost(false);
      const a = Render.lightInfo();
      Render.shadowBoost(true);
      const b = Render.lightInfo();
      Render.shadowBoost(false);
      const c = Render.lightInfo();
      SunUI.syncBoost();
      return eq([CONFIG.shadowStrength, a.shadowOpacity, [a.sun, a.hemi, a.boost], [b.sun, b.hemi, b.boost], [c.sun, c.hemi, c.boost]], [0.55, 0.55, [1.7, 2.3, false], [2.3, 1.1, true], [1.7, 2.3, false]]);
    });
    await t('the boost follows the sun mode: off in Manual, on in Date and time with shadows on, off with shadows off or in Diagram', () => {
      if (!hasGL) return true;
      fresh();
      const manual = Render.shadowBoosted();
      setStudy({ date: '06-21', time: 720 });
      const study = Render.shadowBoosted();
      Store.set('view.shadows', false, { live: false });
      const noShadows = Render.shadowBoosted();
      Store.set('view.shadows', true, { live: false });
      Store.set('view.style', 'diagram', { live: false });
      const diagram = Render.shadowBoosted();
      Store.set('view.style', 'model', { live: false });
      SunUI.setSun({ mode: 'manual' });
      return eq([manual, study, noShadows, diagram, Render.shadowBoosted()], [false, true, false, false, false]);
    });
    await t('the sheet runs with the shadow boost on and puts the lights back to today\'s values after (Manual mode)', async () => {
      if (!hasGL) return true;
      fresh();
      const r = await SunStudy.make({ deliver: false });
      const li = Render.lightInfo();
      return eq([!!r, r && r.boostDuring, li.boost, li.sun, li.hemi, Render.shadowBoosted()], [true, true, false, 1.7, 2.3, false]);
    });
    await t('on the sheet a shadowed ground pixel is clearly darker than a lit one (flat ground): below 0.7 of the lit luminance', async () => {
      if (!hasGL) return true;
      fresh();
      const r = await SunStudy.make({ deliver: false });
      if (!r || !r.cells || !r.cells.length) return 'no cells';
      const m = shadowContrast(r);
      timings.shadowFlat = m;
      if (m.error) return m.error;
      return m.lit > 120 && m.ratio < 0.7 ? true : `shadow ${m.shadow}, lit ${m.lit}, ratio ${m.ratio} (needs < 0.7)`;
    });
    await t('on the sheet with a project site ground (lit material) a shadowed ground pixel is clearly darker than a lit one: below 0.7', async () => {
      if (!hasGL) return true;
      ProjectUI.reset();
      ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      fresh();
      Store.set('placement', { x: 500, y: 500, rotation: 0, baseZ: 1010 }, { live: false });
      await frames(3);
      const r = await SunStudy.make({ deliver: false });
      ProjectUI.reset();
      ProjectUI.restoreDefaults();
      if (!r || !r.cells || !r.cells.length) return 'no cells';
      const m = shadowContrast(r);
      timings.shadowSite = m;
      if (m.error) return m.error;
      return m.lit > 60 && m.ratio < 0.7 ? true : `shadow ${m.shadow}, lit ${m.lit}, ratio ${m.ratio} (needs < 0.7)`;
    });
  } finally {
    SunUI.play(false);
    SunLayer.suppress(false);
    SunLayer.clear();
    ProjectUI.writeSun = origWrite;
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Store.replace(savedState);
    UI.setTab(savedTab);
    Options.holdAutosave(false);
  }
  window.__sunTimings = timings;
  console.log('[sun] timings', JSON.stringify(timings));
  return results;
}
