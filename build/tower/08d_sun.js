/* ==========================================================================
   SUN UI  (docs/tower-project-sun-plan.md sections 4.1, 5.3 and 3.5)
   `SunUI` builds the View tab Sun section (it replaces the schema 1 buildSun), drives the study
   (date, time, place, time zone -> state.view.sun through SolarMod), Play, and the sun-hours controls and
   compute loop (SunHoursMod, in slices; SunLayer draws the result). Writes state.sun and state.view.sun only,
   with one exception: below the horizon it turns view.shadows off (plan section 3.5) and turns it back on
   when the sun is up again (only if it was this code that turned it off).
   ========================================================================== */
const SunUI = (() => {
  const ZONES = [
    ['us-eastern', 'US Eastern'], ['us-central', 'US Central'], ['us-mountain', 'US Mountain'], ['us-pacific', 'US Pacific'],
    ['us-arizona', 'US Arizona (no daylight time)'], ['fixed', 'Fixed offset from UTC'],
  ];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const year = () => new Date().getFullYear();
  const isoOf = (md) => (/^\d{4}-/.test(String(md)) ? String(md) : `${year()}-${md}`);
  const mdOf = (s) => String(s).slice(-5);
  const fmtMD = (md) => { const m = /^(\d{2})-(\d{2})$/.exec(mdOf(md)); return m ? `${MONTHS[+m[1] - 1] || '?'} ${+m[2]}` : String(md); };
  const hm = (min) => { const m = Math.round(min); return `${Math.floor(m / 60) % 24}:${pad2(((m % 60) + 60) % 60)}`; };
  const hm0 = (min) => { const m = Math.round(min); return `${pad2(Math.floor(m / 60) % 24)}:${pad2(((m % 60) + 60) % 60)}`; };
  const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : NaN; };
  const touch = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  const defaults = () => ({
    mode: 'manual',
    place: { source: 'default', lat: 33.749, lon: -84.388 },
    tz: { zone: 'us-eastern', offset: -5 },
    dates: ['03-20', '06-21', '12-21'],
    date: '03-20',
    time: 720,
    times: [540, 720, 900],
    play: false,
    hours: { on: false, spacing: 10, step: 30, date: '03-20', extent: 'site' },
  });
  /** The sun state with every key filled (the stored one may be missing keys). */
  function sunOf(state) {
    const D = defaults(), r = ((state || Store.raw()).sun) || {};
    const three = (a, d) => { const o = Array.isArray(a) ? a.slice(0, 3) : []; while (o.length < 3) o.push(d[o.length]); return o; };
    const fin = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    return {
      mode: r.mode === 'study' ? 'study' : 'manual',
      place: { ...D.place, ...(r.place || {}) },
      tz: { ...D.tz, ...(r.tz || {}) },
      dates: three(r.dates, D.dates).map((x) => mdOf(x)),
      date: typeof r.date === 'string' ? mdOf(r.date) : D.date,
      time: fin(r.time, D.time),
      times: three(r.times, D.times).map((x, i) => fin(x, D.times[i])),
      play: false,
      hours: { ...D.hours, ...(r.hours || {}) },
    };
  }
  const sunState = () => sunOf(Store.raw());

  /* ---- place, time zone, frame ----------------------------------------------------------------------- */
  function siteLatLon() {
    try {
      if (!ProjectUI.has()) return null;
      if (typeof ProjectUI.sitePlace === 'function') {
        const sp = ProjectUI.sitePlace();
        return sp && isFinite(sp.lat) && isFinite(sp.lon) ? { lat: sp.lat, lon: sp.lon } : null;
      }
      const doc = ProjectUI.doc();
      const f = doc && doc.frame;
      if (f && typeof f.lat === 'number' && typeof f.lon === 'number' && isFinite(f.lat) && isFinite(f.lon)) return { lat: f.lat, lon: f.lon };
    } catch (e) { /* no project */ }
    return null;
  }
  const hasSiteCoords = () => !!siteLatLon();
  function placeOf(sun) {
    if (sun.place.source === 'site') {
      const s = siteLatLon();
      if (s) return { ...s, source: 'site', label: 'Project site' };
    }
    if (sun.place.source === 'typed') {
      return { lat: clamp(num(sun.place.lat, 33.749), -90, 90), lon: clamp(num(sun.place.lon, -84.388), -180, 180), source: 'typed', label: 'Typed place' };
    }
    return { lat: SolarMod.ATLANTA.lat, lon: SolarMod.ATLANTA.lon, source: 'default', label: 'Atlanta' };
  }
  const tzArg = (sun) => ({ zone: sun.tz.zone, offset: num(sun.tz.offset, -5) });
  const zoneLabel = (z) => (ZONES.find((x) => x[0] === z) || [z, z])[1];
  const rotation = () => { const p = Store.raw().placement; return p && typeof p === 'object' ? num(p.rotation, 0) : 0; };
  const offsetText = (o) => `UTC${o < 0 ? '−' : '+'}${Math.abs(o)}`;

  function calcAt(sun, md, minutes) {
    const P = placeOf(sun);
    return SolarMod.sunPosition(P.lat, P.lon, SolarMod.localToUTC(isoOf(md), minutes, tzArg(sun)));
  }
  function timesOf(sun, md) {
    const P = placeOf(sun);
    return SolarMod.sunTimes(P.lat, P.lon, isoOf(md), tzArg(sun));
  }
  /** What the light should be: true bearing -> tower frame azimuth, altitude kept at 3 degrees or more. */
  function viewSunFor(sun, rot) {
    const p = calcAt(sun, sun.date, sun.time);
    return { az: r1(SolarMod.localBearing(p.azimuth, rot)), alt: r1(Math.max(p.altitude, 3)), below: p.altitude <= 0, pos: p };
  }

  /* ---- writing the store ------------------------------------------------------------------------------- */
  let shadowsAutoOff = false, sheetMode = false, fixing = false;

  /* Shadow strength (batch-fixes plan 3.2): the light contrast goes up (Render.shadowBoost) while the sheet runs, in the Sun Study mode
     (?study=sun) and during a date and time study, whenever shadows are on in the Model style. Everywhere else the model keeps its look. */
  function boostWanted() {
    if (sheetMode) return true;
    const st = Store.raw();
    if (!st.view || !st.view.shadows || st.view.style === 'diagram') return false;
    return !!((typeof UI !== 'undefined' && UI.studyMode) || (st.sun && st.sun.mode === 'study'));
  }
  function syncBoost() {
    try { if (Render.ready()) Render.shadowBoost(boostWanted()); } catch (e) { console.error(e); }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function shadowOp(below) {
    if (sheetMode) return null;
    const on = !!Store.raw().view.shadows;
    if (below && on) { shadowsAutoOff = true; return ['view.shadows', false]; }
    if (!below && shadowsAutoOff) { shadowsAutoOff = false; if (!on) return ['view.shadows', true]; }
    return null;
  }

  /** Merges a patch into state.sun and, in study mode, writes view.sun from the date, time and place.
   *  live = the drag stays open (one undo step when Store.commit runs); otherwise one step now. */
  function setSun(patch, o = {}) {
    const cur = sunOf();
    const next = {
      ...cur, ...patch,
      place: { ...cur.place, ...(patch.place || {}) },
      tz: { ...cur.tz, ...(patch.tz || {}) },
      hours: { ...cur.hours, ...(patch.hours || {}) },
      play: false,
    };
    const ops = [];
    if (next.mode === 'study') {
      const vs = viewSunFor(next, rotation());
      ops.push(['view.sun', { azimuth: vs.az, altitude: vs.alt }]);
      const so = shadowOp(vs.below);
      ops.push(['sun', next]);
      if (so) ops.push(so);
    } else {
      ops.push(['sun', next]);
      const so = shadowOp(false);
      if (so) ops.push(so);
    }
    fixing = true;
    try {
      for (const [path, value] of ops) Store.set(path, value, { live: true });
      if (!o.live) Store.commit();
    } finally { fixing = false; }
    refreshAll();
  }

  /** After any change from elsewhere (rotation, place from the project): keep view.sun matching the study. */
  function ensureConsistent() {
    const sun = sunOf();
    if (sun.mode !== 'study') return;
    const vs = viewSunFor(sun, rotation());
    const cur = Store.raw().view.sun || {};
    const ops = [];
    if (Math.abs(num(cur.azimuth, -999) - vs.az) > 0.05 || Math.abs(num(cur.altitude, -999) - vs.alt) > 0.05) ops.push(['view.sun', { azimuth: vs.az, altitude: vs.alt }]);
    const so = shadowOp(vs.below);
    if (so) ops.push(so);
    if (!ops.length) return;
    const had = Store.gestureActive();
    fixing = true;
    try {
      for (const [path, value] of ops) Store.set(path, value, { live: true });
      if (!had) Store.commit();
    } finally { fixing = false; }
  }

  /* ---- play ------------------------------------------------------------------------------------------------- */
  let playing = false, rafId = 0, lastT = 0;
  const dayBounds = (sun) => {
    const t = timesOf(sun, sun.date);
    if (t.polar === 'night') return null;
    if (t.polar === 'day' || t.sunrise == null || t.sunset == null) return { rise: 0, set: 1440, noon: t.noon };
    return { rise: t.sunrise, set: t.sunset, noon: t.noon };
  };
  function tick(now) {
    if (!playing) return;
    const dt = Math.min(0.25, (now - lastT) / 1000);
    lastT = now;
    const sun = sunOf(), b = dayBounds(sun);
    if (!b) { play(false); return; }
    const t = sun.time + 60 * dt;                       // one hour per second
    if (t >= b.set) { setSun({ time: Math.floor(b.set) }, { live: true }); play(false); return; }
    setSun({ time: r1(t) }, { live: true });
    rafId = requestAnimationFrame(tick);
  }
  function play(on) {
    on = !!on;
    if (on === playing) return;
    if (on) {
      let sun = sunOf();
      if (sun.mode !== 'study') { setSun({ mode: 'study' }); sun = sunOf(); }
      const b = dayBounds(sun);
      if (!b) { refreshAll(); return; }
      playing = true;
      if (sun.time >= b.set - 1 || sun.time < b.rise) setSun({ time: Math.ceil(b.rise) }, { live: true });
      lastT = performance.now();
      rafId = requestAnimationFrame(tick);
    } else {
      playing = false;
      cancelAnimationFrame(rafId);
      setSun({ time: Math.round(sunOf().time) });       // whole minute, closes the drag (one undo step)
    }
    refreshAll();
  }

  /* ---- sun hours ---------------------------------------------------------------------------------------------- */
  let job = null;
  let lastRun = null;                                   // { ms, computeMs, ... } of the last finished compute
  const nextFrame = () => new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(go);
    setTimeout(go, 60);                                 // a hidden tab does not run animation frames
  });
  const MAX_NODES = 360000;

  function projectFrameOn(sun) {
    return sun.hours.extent !== 'local' && ProjectUI.has() && ProjectUI.hasSite();
  }
  function placementObj() {
    const p = Store.raw().placement;
    return p && typeof p === 'object' && isFinite(p.x) && isFinite(p.y) ? { x: p.x, y: p.y, rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : null;
  }
  /** The node grid for the current settings: { grid, frame, placement }. */
  function gridFor(sun, d) {
    let box, frame = 'local', pl = null;
    const info = projectFrameOn(sun) ? ProjectUI.siteInfo() : null;
    if (info && Array.isArray(info.boundary) && info.boundary.length >= 3) {
      frame = 'project'; pl = placementObj();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const q of info.boundary) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
      box = { minX, minY, maxX, maxY };
    } else {
      const s = d.bounds.site, u = d.bounds.union;
      box = { minX: Math.min(s.minX, u.minX) - 300, minY: Math.min(s.minY, u.minY) - 300, maxX: Math.max(s.maxX, u.maxX) + 300, maxY: Math.max(s.maxY, u.maxY) + 300 };
    }
    let spacing = [5, 10, 20].includes(+sun.hours.spacing) ? +sun.hours.spacing : (num(sun.hours.spacing, 10) > 0 ? +sun.hours.spacing : 10);
    let grid = SunHoursMod.sunGrid(box, spacing);
    while (grid.nx * grid.ny > MAX_NODES) { spacing *= 2; grid = SunHoursMod.sunGrid(box, spacing); }
    return { grid, frame, placement: pl };
  }
  /** What a sun-hours result depends on. A change after a compute marks it out of date. */
  function staleKey(state, d) {
    const sun = sunOf(state), c = state.context || {};
    const pl = sun.hours.extent !== 'local' ? state.placement : null;   // the project-frame grid depends on where the tower stands
    const site = sun.place.source === 'site' ? siteLatLon() : null;
    return JSON.stringify([d.geomId, c.show, c.blocks, pl, sun.place, site, sun.tz, sun.hours.date, sun.hours.spacing, sun.hours.step, sun.hours.extent]);
  }

  async function runCompute(j) {
    const t0 = performance.now();
    const state = Store.raw(), sun = sunOf(state), hrs = sun.hours;
    const d = Derived.get();
    const P = placeOf(sun), tz = tzArg(sun);
    const { grid, frame, placement } = gridFor(sun, d);
    const cs = SunHoursMod.casters(state, { plates: d.plates, solids: d.solids }, frame === 'project' ? placement : null);
    const samples = SunHoursMod.samplesFor(P.lat, P.lon, isoOf(hrs.date), tz, num(hrs.step, 30) > 0 ? +hrs.step : 30);
    const key = staleKey(state, d);
    const acc = new Float64Array(grid.nx * grid.ny);
    j.total = samples.length; j.done = 0;
    let computeMs = 0, cancelled = false;
    for (let k = 0; k < samples.length;) {
      if (j.cancel) { cancelled = true; break; }
      const slice0 = performance.now();
      do {
        const r = SunHoursMod.sunHours(cs, grid, samples.slice(k, k + 2));
        for (let i = 0; i < acc.length; i++) acc[i] += r.hours[i];
        k += 2;
      } while (k < samples.length && !j.cancel && performance.now() - slice0 < 10);
      computeMs += performance.now() - slice0;
      j.done = Math.min(k, samples.length);
      refreshHours();
      await nextFrame();
    }
    const out = { cancelled, ms: Math.round(performance.now() - t0), computeMs: Math.round(computeMs), nx: grid.nx, ny: grid.ny, nodes: grid.nx * grid.ny, spacing: grid.spacing, step: +hrs.step, frame, samples: samples.length, casters: cs.length };
    if (cancelled) return out;
    const dayLength = samples.reduce((a, s) => a + s.dt, 0) / 60;
    SunLayer.setResult({
      key, frame, spacing: grid.spacing, nx: grid.nx, ny: grid.ny, x0: grid.x0, y0: grid.y0, date: hrs.date, step: +hrs.step,
      hours: Float32Array.from(acc), dayLength, samples: samples.length, ms: out.ms,
    });
    lastRun = out;
    sendResult({ spacing: grid.spacing, n: grid.n, nx: grid.nx, ny: grid.ny, x0: grid.x0, y0: grid.y0, frame, date: hrs.date, step: +hrs.step, hours: SunLayer.result().hours });
    if (!hrs.on) setSun({ hours: { on: true } });
    return out;
  }

  /** Starts a sun-hours compute (opts may change the form first: spacing, step, date, extent). Resolves to a summary. */
  function compute(opts) {
    if (job) return job.promise;
    const patch = {};
    for (const k of ['spacing', 'step', 'date', 'extent']) if (opts && opts[k] !== undefined) patch[k] = opts[k];
    if (Object.keys(patch).length) setSun({ hours: patch });
    const j = { cancel: false, done: 0, total: 0 };
    job = j;
    j.promise = runCompute(j).then((r) => { job = null; refreshAll(); return r; }, (e) => {
      job = null; refreshAll();
      console.error(e);
      Toast.show(e && e.message ? `Sun hours: ${e.message}` : 'The sun hours could not be computed.', 'bad', 6000);
      return { error: String((e && e.message) || e), cancelled: false };
    });
    refreshAll();
    return j.promise;
  }
  function cancel() { if (job) { job.cancel = true; } }

  /* ---- the project file ------------------------------------------------------------------------------------------- */
  // ProjectUI (09b_project.js) writes the sun section itself (state, samples, place) with the next save; the sun-hours result goes
  // in through ProjectUI.writeSun(result). A result stored in an opened project comes back through ProjectUI.sunHoursStored().
  const hasWriteSun = () => typeof ProjectUI !== 'undefined' && typeof ProjectUI.writeSun === 'function';
  function sendResult(r) {
    try { if (hasWriteSun()) ProjectUI.writeSun(r); } catch (e) { console.error(e); }
  }
  let restoredFor = null;
  function restoreStored() {
    try {
      if (SunLayer.result() || job || typeof ProjectUI.sunHoursStored !== 'function' || !ProjectUI.has()) return;
      const doc = ProjectUI.doc(), id = doc && `${doc.id}|${doc.updatedAt}`;
      if (!id || restoredFor === id) return;
      restoredFor = id;
      const sh = ProjectUI.sunHoursStored();
      if (!sh || !sh.hours || !sh.nx) return;
      const sun = sunOf(), P = placeOf(sun), md = mdOf(sh.date || sun.hours.date);
      const samples = SunHoursMod.samplesFor(P.lat, P.lon, isoOf(md), tzArg(sun), num(sh.step, 30));
      SunLayer.setResult({
        key: staleKey(Store.raw(), Derived.get()), frame: sh.frame === 'local' ? 'local' : 'project', spacing: sh.spacing, nx: sh.nx, ny: sh.ny, x0: sh.x0, y0: sh.y0,
        date: md, step: num(sh.step, 30), hours: sh.hours, dayLength: samples.reduce((a, x) => a + x.dt, 0) / 60, samples: samples.length, ms: 0,
      });
    } catch (e) { console.error(e); }
  }

  /* ---- the panel ---------------------------------------------------------------------------------------------- */
  const refreshers = [];
  function refreshAll() { for (const fn of refreshers) { try { fn(); } catch (e) { console.error(e); } } }
  let hoursRefresh = null;
  function refreshHours() { if (hoursRefresh) hoursRefresh(); }

  function chipRow(label, itemsFn, get, set, attr) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label || attr, 'data-sun': attr });
    let key = '';
    const refresh = () => {
      const items = itemsFn(), k = JSON.stringify(items);
      if (k !== key) {
        key = k; wrap.textContent = '';
        for (const it of items) wrap.append(h('button', { class: 'chip', type: 'button', 'data-value': String(it.value), onclick: () => set(it.value) }, it.label));
      }
      for (const b of wrap.children) b.setAttribute('aria-pressed', b.dataset.value === String(get()) ? 'true' : 'false');
    };
    refreshers.push(refresh);
    refresh();
    return h('div', { class: 'ctl' }, label ? h('div', { class: 'ctl-label' }, label) : null, wrap);
  }
  function selectRow(label, options, get, set, attr) {
    const id = `sunsel-${attr}`;
    const sel = h('select', { id, 'data-sun': attr }, options.map((x) => h('option', { value: x.value }, x.label)));
    sel.addEventListener('change', () => set(sel.value));
    const refresh = () => {
      for (const o of sel.options) { const dis = options.find((x) => x.value === o.value); o.disabled = !!(dis && dis.disabled && dis.disabled()); }
      const v = get(); if (v != null && sel.value !== String(v)) sel.value = String(v);
    };
    refreshers.push(refresh);
    refresh();
    return h('div', { class: 'ctl select-row' }, h('label', { for: id }, label), sel);
  }
  const fieldBind = (get, set) => ({ get, set: (v, live) => set(v, !!live), commit: () => Store.commit() });

  function buildTimeRow() {
    const range = h('input', { class: 'range', type: 'range', min: 0, max: 1440, step: 15, 'aria-label': 'Time of day', 'data-sun': 'time-slider' });
    const field = h('input', { class: 'numfield', type: 'time', step: 900, 'aria-label': 'Time', 'data-sun': 'time-field', style: 'width:auto;min-width:96px' });
    range.addEventListener('input', () => setSun({ time: +range.value }, { live: true }));
    for (const ev of ['change', 'pointerup', 'pointercancel', 'blur']) range.addEventListener(ev, () => Store.commit());
    field.addEventListener('change', () => { const m = parseHM(field.value); if (isFinite(m)) setSun({ time: m }); });
    refreshers.push(() => {
      const sun = sunOf(), b = dayBounds(sun);
      const lo = b ? Math.floor(b.rise / 15) * 15 : 0, hi = b ? Math.ceil(b.set / 15) * 15 : 1440;
      range.min = lo; range.max = hi;
      range.value = clamp(sun.time, lo, hi);
      range.style.setProperty('--pf', hi > lo ? clamp((sun.time - lo) / (hi - lo), 0, 1) : 0);
      range.setAttribute('aria-valuetext', hm(sun.time));
      if (document.activeElement !== field) field.value = hm0(sun.time);
    });
    return h('div', { class: 'ctl' }, h('label', { class: 'ctl-label' }, 'Time of day (sunrise to sunset)'), h('div', { class: 'ctl-row' }, range, field));
  }

  function build(ctx) {
    const { bs } = ctx;
    const isStudy = () => sunOf().mode === 'study';
    const legacy = ctx.legacy();

    const modeSel = selectRow('Mode', [{ value: 'manual', label: 'Manual (azimuth and altitude)' }, { value: 'study', label: 'Date and time (real sun)' }],
      () => sunOf().mode, (v) => { if (v !== 'study') play(false); setSun({ mode: v }); }, 'mode');

    /* date */
    const dateRow = h('div', { class: 'ctl' }, h('label', { class: 'ctl-label' }, 'Date'));
    const dateChips = chipRow(null, () => sunOf().dates.map((md) => ({ value: md, label: fmtMD(md) })), () => sunOf().date, (md) => setSun({ date: md }), 'date-presets');
    const dateField = h('input', { class: 'numfield', type: 'date', 'aria-label': 'Custom date', 'data-sun': 'date-field', style: 'width:auto;min-width:140px' });
    dateField.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateField.value)) setSun({ date: dateField.value.slice(5) }); });
    refreshers.push(() => { dateField.value = isoOf(sunOf().date); });
    dateRow.append(dateChips, dateField);

    /* time and play */
    const timeChips = chipRow(null, () => sunOf().times.map((t) => ({ value: t, label: hm(t) })), () => sunOf().time, (t) => setSun({ time: +t }), 'time-presets');
    const playBtn = h('button', { class: 'btn outline sm', type: 'button', 'data-sun': 'play', style: 'min-height:44px;min-width:88px', onclick: () => play(!playing) }, 'Play');
    refreshers.push(() => { playBtn.textContent = playing ? 'Stop' : 'Play'; playBtn.classList.toggle('is-on', playing); playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false'); });
    const timeBlock = h('div', { class: 'ctl' }, buildTimeRow(), h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, timeChips, playBtn));

    /* place and time zone */
    const placeSel = selectRow('Place', [
      { value: 'default', label: 'Atlanta (default)' },
      { value: 'site', label: 'Project site', disabled: () => !hasSiteCoords() },
      { value: 'typed', label: 'Typed latitude and longitude' },
    ], () => sunOf().place.source, (v) => {
      if (v === 'typed') { const P = placeOf(sunOf()); setSun({ place: { source: 'typed', lat: r2(P.lat), lon: r2(P.lon) } }); } else setSun({ place: { source: v } });
    }, 'place');
    const latF = Controls.slider({ label: 'Latitude (north +)', compact: true, bind: fieldBind(() => num(sunOf().place.lat, 33.749), (v, live) => setSun({ place: { source: 'typed', lat: v } }, { live })), min: -90, max: 90, step: 0.1, hardMin: -90, hardMax: 90, format: (v) => String(Math.round(v * 1000) / 1000), inputMode: 'decimal' });
    const lonF = Controls.slider({ label: 'Longitude (east +)', compact: true, bind: fieldBind(() => num(sunOf().place.lon, -84.388), (v, live) => setSun({ place: { source: 'typed', lon: v } }, { live })), min: -180, max: 180, step: 0.1, hardMin: -180, hardMax: 180, format: (v) => String(Math.round(v * 1000) / 1000), inputMode: 'decimal' });
    const typed = Controls.when(() => sunOf().place.source === 'typed', [Controls.group([latF.el, lonF.el])]);
    const tzSel = selectRow('Time zone', ZONES.map(([value, label]) => ({ value, label })), () => sunOf().tz.zone, (v) => setSun({ tz: { zone: v } }), 'tz');
    const offF = Controls.slider({ label: 'Offset from UTC (hours)', compact: true, bind: fieldBind(() => num(sunOf().tz.offset, -5), (v, live) => setSun({ tz: { zone: 'fixed', offset: v } }, { live })), min: -12, max: 14, step: 0.5, hardMin: -12, hardMax: 14, format: (v) => offsetText(v), parse: (t) => parseFloat(String(t).replace('−', '-').replace(/[^0-9.+-]/g, '')), inputMode: 'decimal' });
    const fixedOff = Controls.when(() => sunOf().tz.zone === 'fixed', [offF.el]);
    const siteNote = h('p', { class: 'help', 'data-sun': 'place-note' });
    refreshers.push(() => {
      const sun = sunOf(), P = placeOf(sun);
      const fell = sun.place.source === 'site' && P.source !== 'site';
      siteNote.textContent = fell ? 'This project has no site coordinates, so Atlanta is used.' : `${P.label}: ${P.lat.toFixed(3)}, ${P.lon.toFixed(3)}`;
    });

    /* readout */
    const readout = h('div', { 'data-sun': 'readout', style: 'display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;font-size:12.5px;margin:6px 0 4px' });
    const readNote = h('p', { class: 'help', 'data-sun': 'read-note', style: 'color:var(--warn)' });
    refreshers.push(() => {
      const sun = sunOf();
      const p = calcAt(sun, sun.date, sun.time), t = timesOf(sun, sun.date), rot = rotation();
      const off = SolarMod.tzOffset(sun.tz.zone, isoOf(sun.date), sun.time, sun.tz.offset);
      const rows = [
        ['Azimuth (true bearing)', `${p.azimuth.toFixed(1)}°`], ['Altitude', `${p.altitude.toFixed(1)}°`],
        ['Sunrise', t.sunrise == null ? '—' : hm(t.sunrise)], ['Sunset', t.sunset == null ? '—' : hm(t.sunset)],
        ['Solar noon', hm(t.noon)], ['Time zone now', offsetText(off)],
      ];
      readout.textContent = '';
      for (const [k, v] of rows) readout.append(h('span', { style: 'color:var(--ink-3)' }, k), h('span', { style: 'font-weight:600;text-align:right' }, v));
      const notes = [];
      if (p.altitude <= 0) notes.push('Sun below the horizon. Shadows are off.');
      if (t.polar === 'day') notes.push('Polar day: the sun does not set.');
      if (t.polar === 'night') notes.push('Polar night: the sun does not rise.');
      readNote.textContent = notes.join(' ');
      readNote.hidden = !notes.length;
      if (rot) readout.append(h('span', { style: 'color:var(--ink-3)' }, 'In the tower frame'), h('span', { style: 'font-weight:600;text-align:right' }, `${SolarMod.localBearing(p.azimuth, rot).toFixed(1)}°`));
    });

    /* shadow study sheet */
    const sheetBtn = h('button', { class: 'btn solid sm', type: 'button', 'data-sun': 'sheet', style: 'min-height:44px', onclick: () => sheetClick() }, 'Make shadow study sheet');
    const sheetFields = h('div', { style: 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:4px 0' });
    const dateIn = [0, 1, 2].map((i) => {
      const f = h('input', { class: 'numfield', type: 'date', 'aria-label': `Sheet date ${i + 1}`, 'data-sun': `sheet-date-${i}`, style: 'width:100%' });
      f.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(f.value)) { const d = sunOf().dates.slice(); d[i] = f.value.slice(5); setSun({ dates: d }); } });
      return f;
    });
    const timeIn = [0, 1, 2].map((i) => {
      const f = h('input', { class: 'numfield', type: 'text', inputmode: 'numeric', placeholder: 'h:mm', autocomplete: 'off', 'aria-label': `Sheet time ${i + 1} (24-hour, h:mm)`, 'data-sun': `sheet-time-${i}`, style: 'width:100%' });
      f.addEventListener('change', () => { const m = parseHM(f.value); if (isFinite(m)) { const t = sunOf().times.slice(); t[i] = m; setSun({ times: t }); } });
      return f;
    });
    sheetFields.append(...dateIn, ...timeIn);
    refreshers.push(() => {
      const sun = sunOf();
      dateIn.forEach((f, i) => { f.value = isoOf(sun.dates[i]); });
      timeIn.forEach((f, i) => { if (document.activeElement !== f) f.value = hm(sun.times[i]); });
      const busy = SunStudy.busy();
      sheetBtn.disabled = busy; sheetBtn.textContent = busy ? 'Making the sheet…' : 'Make shadow study sheet';
    });

    /* sun hours */
    const hoursDate = chipRow('Date', () => sunOf().dates.map((md) => ({ value: md, label: fmtMD(md) })), () => sunOf().hours.date, (md) => setSun({ hours: { date: md } }), 'hours-date');
    const spacingRow = chipRow('Grid spacing', () => [5, 10, 20].map((v) => ({ value: v, label: `${v} ft` })), () => num(sunOf().hours.spacing, 10), (v) => setSun({ hours: { spacing: +v } }), 'hours-spacing');
    const stepRow = chipRow('Time step', () => [15, 30, 60].map((v) => ({ value: v, label: `${v} min` })), () => num(sunOf().hours.step, 30), (v) => setSun({ hours: { step: +v } }), 'hours-step');
    const extentRow = Controls.when(() => ProjectUI.has() && ProjectUI.hasSite(), [chipRow('Area', () => [{ value: 'site', label: 'Project site' }, { value: 'local', label: 'Around the tower' }], () => sunOf().hours.extent, (v) => setSun({ hours: { extent: v } }), 'hours-extent')]);
    const computeBtn = h('button', { class: 'btn solid sm', type: 'button', 'data-sun': 'compute', style: 'min-height:44px;min-width:110px', onclick: () => { compute(); } }, 'Compute');
    const cancelBtn = h('button', { class: 'btn outline sm', type: 'button', 'data-sun': 'cancel', style: 'min-height:44px;min-width:88px', onclick: () => cancel() }, 'Cancel');
    const progress = h('progress', { max: 1, value: 0, 'data-sun': 'progress', style: 'width:100%;height:8px' });
    const status = h('p', { class: 'help', 'data-sun': 'hours-status' });
    const badge = h('span', { 'data-sun': 'stale', style: 'color:var(--warn);font-weight:600;font-size:12px' }, 'Out of date');
    const showT = Controls.toggle({ label: 'Show sun hours on the ground', bind: { get: () => !!sunOf().hours.on, set: (v) => setSun({ hours: { on: !!v } }), commit: () => {} } });
    hoursRefresh = () => {
      const busy = !!job, info = SunLayer.info();
      computeBtn.disabled = busy; cancelBtn.hidden = !busy; progress.hidden = !busy;
      if (busy) { progress.max = Math.max(1, job.total); progress.value = job.done; }
      badge.hidden = !(info.stale && info.result);
      const r = info.result;
      status.textContent = busy ? `Computing… ${job.done} of ${job.total} times` : r
        ? `${fmtMD(r.date)}: ${r.nx} × ${r.ny} nodes at ${r.spacing} ft, ${r.samples == null ? '' : r.samples + ' times, '}${((r.ms || 0) / 1000).toFixed(2)} s. Day length ${r.dayLength.toFixed(1)} h. Most sun ${r.max.toFixed(1)} h.`
        : 'Not computed yet. Compute runs once, on demand.';
    };
    refreshers.push(hoursRefresh);

    const noteHours = Controls.help('Sun hours use flat ground at the tower ground floor. The tower and the context blocks cast shadow; terrain does not.');

    const studyBody = [
      dateRow, timeBlock, placeSel, typed.el, siteNote, tzSel, fixedOff.el, readout, readNote,
      Controls.label('Shadow study sheet'),
      Controls.help('Three dates by three times in one picture (plan view, shadows on). Change the dates and times below.'),
      sheetFields, sheetBtn,
      Controls.label('Sun hours'),
      hoursDate, spacingRow, stepRow, extentRow.el,
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0' }, computeBtn, cancelBtn, badge),
      progress, status, showT.el, noteHours,
    ];
    const study = Controls.when(isStudy, studyBody);
    const manual = Controls.when(() => !isStudy(), legacy.children);
    refreshers.push(() => { study.refresh(); });
    // Sun Study mode hides the Site tab, so Context from site is offered here (batch-fixes plan 11).
    const ctxSite = Controls.when(() => !!(typeof UI !== 'undefined' && UI.studyMode) && ProjectUI.has() && ProjectUI.hasSite(),
      [h('div', { class: 'add-row' }, Controls.button('Context from site', () => ProjectUI.contextFromSite(), 'outline sm'), Controls.help('Loads the neighbors around the tower from the project site so their shadows show.'))]);
    refreshers.push(() => { ctxSite.refresh(); });
    refreshAll();
    return { children: [modeSel, ctxSite.el, manual.el, study.el] };
  }

  async function sheetClick() {
    try { await SunStudy.make({ deliver: true }); } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The sheet could not be made.', 'bad', 6000); }
    refreshAll();
  }

  /* ---- start ------------------------------------------------------------------------------------------------------ */
  function onStore(state, info) {
    const kind = info && info.kind;
    if (kind === 'replace') shadowsAutoOff = false;
    if (!fixing && kind !== 'undo' && kind !== 'redo') ensureConsistent();
    restoreStored();
    syncBoost();
    refreshAll();
  }
  /** Called once from 13_start.js after UI.init() and before ProjectUI.start(). */
  function init() {
    SunLayer.setKeyFn(staleKey);
    SunLayer.onChange(() => { refreshHours(); });
    Store.subscribe(onStore);
    // A touch device starts with the cheaper sun-hours settings (plan section 5.4). Written silently: no undo step.
    try {
      const raw = Store.raw();
      if (touch() && raw.sun && raw.sun.hours && raw.sun.hours.spacing === 10 && raw.sun.hours.step === 30 && !raw.sun.hours.on) { raw.sun.hours.spacing = 20; raw.sun.hours.step = 60; }
    } catch (e) { /* ignore */ }
    ensureConsistent();
    syncBoost();
    refreshAll();
  }
  /** For tests and the __tower hooks. */
  function info() {
    const sun = sunOf(), st = Store.raw(), P = placeOf(sun), t = timesOf(sun, sun.date), p = calcAt(sun, sun.date, sun.time);
    return {
      mode: sun.mode, date: sun.date, time: sun.time, dates: sun.dates, times: sun.times, playing, play: playing,
      place: { source: P.source, label: P.label, lat: P.lat, lon: P.lon }, tz: { ...sun.tz, offset: SolarMod.tzOffset(sun.tz.zone, isoOf(sun.date), sun.time, sun.tz.offset) },
      azimuth: p.azimuth, altitude: p.altitude, below: p.altitude <= 0, sunrise: t.sunrise, noon: t.noon, sunset: t.sunset, polar: t.polar,
      rotation: rotation(), viewSun: { ...st.view.sun }, shadows: !!st.view.shadows, shadowsAutoOff,
      hours: { ...sun.hours, computing: !!job, progress: job ? { done: job.done, total: job.total } : null, last: lastRun },
    };
  }

  return {
    build, init, info, compute, cancel, play,
    sunState, setSun, gridFor,
    placeText: () => { const P = placeOf(sunOf()); return `${P.label} (${P.lat.toFixed(3)}, ${P.lon.toFixed(3)})`; },
    tzText: () => { const s = sunOf(); return s.tz.zone === 'fixed' ? `Fixed ${offsetText(num(s.tz.offset, -5))}` : zoneLabel(s.tz.zone); },
    dayOffsetText: (md) => { const s = sunOf(); return offsetText(SolarMod.tzOffset(s.tz.zone, isoOf(md), 720, s.tz.offset)); },
    calcAt: (md, minutes) => calcAt(sunOf(), md, minutes),
    sheetMode: (on) => { sheetMode = !!on; syncBoost(); },
    syncBoost, boostWanted,
    fmtMD, hm, isoOf,
  };
})();
