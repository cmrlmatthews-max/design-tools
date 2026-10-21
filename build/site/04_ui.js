/* ==========================================================================
   UI
   Top bar, control panel, progress list, metrics, downloads, screenshot,
   recent sites and the bottom sheet (iPad portrait and phone).
   ========================================================================== */
const App = (() => {
  const { googleMapsUrl, parseCoordinates } = GeocodeMod;
  const { summarize } = ModelMod;
  const { revitCsv, siteDxf, notesMarkdown, CREDITS } = ExportsMod;

  const state = {
    size: CONFIG.defaultSize,
    layers: { ground: true, buildings: true, roads: true, walks: false, trees: true, water: true },
    vscale: 1, contour: 0,
    busy: false, runId: 0, t0: 0, timer: 0,
    result: null, typed: '', elapsed: null,
  };
  const els = {};
  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const sheetQuery = window.matchMedia('(max-width: 899px), (orientation: portrait)');

  /* ---- naming ------------------------------------------------------------------ */
  function slugOf(r = state.result) {
    const base = (state.typed || (r && r.loc.label) || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'site';
    return `${base}-${r ? r.frame.size : state.size}ft`;
  }
  const todayIso = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function metaOf(r = state.result) {
    return { address: state.typed || r.loc.label, lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, release: r.release, date: todayIso() };
  }

  /* ---- progress list ----------------------------------------------------------------- */
  function setStep(step, status, msg) {
    const li = els.steps && els.steps.querySelector(`[data-step="${step}"]`);
    if (!li) return;
    li.dataset.s = status;
    li.querySelector('.ms').textContent = msg || (status === 'pending' ? 'Waiting' : '');
  }
  function setProgressOpen(open) {
    els.progressHead.setAttribute('aria-expanded', String(open));
    els.steps.hidden = !open;
  }
  function resetSteps() { for (const [k] of CONFIG.steps) setStep(k, 'pending'); }
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  function chip(text, kind = '') {
    els.chip.hidden = !text;
    els.chip.textContent = text || '';
    els.chip.className = `status-chip ${kind}`.trim();
  }
  function tick() { const t = secs(performance.now() - state.t0); els.elapsed.textContent = t; chip(`Loading the site, ${t}`); }

  /* ---- metrics ------------------------------------------------------------------------- */
  function renderMetrics() {
    const r = state.result, box = els.metrics;
    box.textContent = '';
    if (!r) { box.append(h('p', { class: 'help' }, 'Metrics appear after the site loads.')); return; }
    const m = r.model, s = summarize(m), g = m.ground;
    const row = (k, v, small) => [h('dt', null, k), h('dd', null, v, small ? h('small', null, ` ${small}`) : null)];
    box.append(h('dl', { class: 'kv' },
      row('Buildings', grouped(s.buildings), s.estimated ? `${grouped(s.estimated)} estimated` : ''),
      row('Road length', fmtFt(s.roadsFt, 0)),
      row('Trees', grouped(s.trees)),
      row('Water areas', grouped(s.waterAreas)),
      row('Ground', `${grouped(s.groundMin, 1)} to ${grouped(s.groundMax, 1)} ft`),
      row('Grid spacing', fmtFt(g.spacing, 1)),
      row('Grid points', grouped(g.n * g.n), `${g.n} by ${g.n}`),
    ));
  }

  /* ---- recent sites ----------------------------------------------------------------------- */
  const loadRecents = () => { const v = Local.get(CONFIG.recentKey, []); return Array.isArray(v) ? v.filter((e) => e && e.text && e.size && Number.isFinite(e.lat) && Number.isFinite(e.lon)) : []; };
  function saveRecent(r) {
    const entry = { text: state.typed || r.loc.label, label: r.loc.label, lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, t: Date.now() };
    const list = loadRecents().filter((e) => !(e.text === entry.text && e.size === entry.size));
    list.unshift(entry);
    Local.set(CONFIG.recentKey, list.slice(0, CONFIG.recentMax));
    renderRecents();
  }
  function renderRecents() {
    const list = loadRecents(), box = els.recents;
    box.textContent = '';
    els.recentsWrap.hidden = !list.length;
    for (const e of list) {
      box.append(h('button', { class: 'recent', type: 'button', title: e.label, onclick: () => { els.addr.value = e.text; setSize(e.size); go({ text: e.text, size: e.size, loc: { lat: e.lat, lon: e.lon, label: e.label } }); } },
        h('span', { class: 't' }, e.text), h('span', { class: 's' }, `${grouped(e.size)} ft`)));
    }
  }

  /* ---- the Go action ------------------------------------------------------------------------- */
  function setBusy(b) {
    state.busy = b;
    els.go.disabled = b;
    els.go.textContent = b ? 'Working' : 'Go';
    els.viewport.dataset.busy = String(b && !!state.result);
    syncActions();
  }
  function setSize(v) { state.size = v; els.size.value = String(v); }

  async function go(req = {}) {
    if (state.busy) return;
    const text = (req.text != null ? req.text : els.addr.value).trim();
    if (!text) { Toast.show('Type an address, coordinates, or a Google Maps link first.', 'warn'); els.addr.focus(); return; }
    const size = req.size || state.size;
    const id = ++state.runId;
    els.progressSec.hidden = false;
    setProgressOpen(true);
    resetSteps();
    setBusy(true);
    state.t0 = performance.now();
    clearInterval(state.timer);
    state.timer = setInterval(tick, 200);
    tick();
    let r = null, failure = null;
    try {
      r = await Pipeline.run({ text, size, loc: req.loc }, (step, st, msg) => { if (id === state.runId) setStep(step, st, msg); }, { walks: !!state.layers.walks, fetchFn: req.fetchFn });
    } catch (e) { failure = e; }
    clearInterval(state.timer);
    const dt = performance.now() - state.t0;
    els.elapsed.textContent = secs(dt);
    setBusy(false);
    if (id !== state.runId) return;
    if (failure) {
      console.error(failure);
      chip(failure.message, 'bad');
      Toast.show(failure.message, 'bad', 8000);
      return;
    }
    state.typed = text;
    state.result = r;
    state.elapsed = dt;
    r.uiMs = Math.round(dt);
    if (!r.failed.length) setProgressOpen(false);          // all done: fold the list, one tap opens it
    const t1 = performance.now();
    Scene.setModel(r.model);
    r.timings.scene = Math.round(performance.now() - t1);
    els.empty.hidden = true;
    renderMetrics();
    syncActions();
    saveRecent(r);
    const bad = r.failed.map((k) => CONFIG.steps.find((s) => s[0] === k)[1]);
    chip(bad.length ? `Loaded in ${secs(dt)}. Not loaded: ${bad.join(', ')}` : `Loaded in ${secs(dt)}`, bad.length ? 'bad' : '');
    if (bad.length) Toast.show(`${bad.join(' and ')} could not be loaded. The rest of the site is shown.`, 'warn', 7000);
    else setTimeout(() => { if (!state.busy) chip(''); }, 5000);
  }

  /* ---- layers, scale, contours ------------------------------------------------------------------ */
  function toggleLayer(key, on) {
    state.layers[key] = on;
    for (const b of els.toggles.querySelectorAll('[data-layer]')) if (b.dataset.layer === key) b.setAttribute('aria-checked', String(on));
    if (key === 'walks' && on && state.result && !state.result.model.roads.walks) {
      chip('Building walks');
      setTimeout(() => {
        try {
          const roads = Pipeline.buildWalks(state.result);
          Scene.setWalks(roads);
          Scene.setLayer('walks', state.layers.walks);
          chip(`${roads.walks ? roads.walks.length : 0} walk areas added`);
          setTimeout(() => { if (!state.busy) chip(''); }, 2500);
        } catch (e) { console.error(e); chip(''); Toast.show(`Walks could not be built. ${e.message}`, 'bad', 6000); }
      }, 20);
    }
    Scene.setLayer(key, on);
  }
  function setSegPressed(group, attr, val) {
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset[attr]) === val));
  }
  function setVScale(v) { state.vscale = v; setSegPressed(els.scaleSeg, 'scale', v); Scene.setVScale(v); }
  function setContour(v) { state.contour = v; setSegPressed(els.contourSeg, 'contour', v); Scene.setContour(v); }

  /* ---- downloads and screenshot -------------------------------------------------------------------- */
  const FILES = {
    csv: { suffix: 'topo.csv', type: 'text/csv', make: (r) => revitCsv(r.model.ground) },
    dxf: { suffix: 'site.dxf', type: 'application/dxf', make: (r) => siteDxf(r.model) },
    notes: { suffix: 'notes.md', type: 'text/markdown', make: (r) => notesMarkdown(r.model, metaOf(r)) },
  };
  function fileFor(kind, r = state.result) {
    const f = FILES[kind];
    return { name: `${slugOf(r)}-${f.suffix}`, text: f.make(r), type: f.type };
  }
  async function download(kind) {
    Pop.close();
    if (!state.result) return;
    try {
      const f = fileFor(kind);
      const res = await ShotMod.deliverImage(new Blob([f.text], { type: f.type }), f.name);
      if (res === 'downloaded') Toast.show(`Saved ${f.name}`);
    } catch (e) { console.error(e); Toast.show(`The file could not be made. ${e.message}`, 'bad', 6000); }
  }
  function openDownloads() {
    const item = (kind, title, sub) => h('button', { class: 'pop-item', type: 'button', 'data-dl': kind, onclick: () => download(kind) }, h('span', { class: 'grow' }, title, h('small', null, sub)));
    Pop.open(els.btnDl, h('div', { role: 'menu' },
      item('csv', 'Revit CSV', 'Ground points for a Revit toposolid'),
      item('dxf', 'DXF', 'Topo mesh, buildings, roads, trees, water'),
      item('notes', 'Notes', 'Origin, counts, and Revit import steps')));
  }
  function overlayMetrics(r) {
    const s = summarize(r.model);
    return [
      ['Site', `${grouped(r.frame.size)} ft square`],
      ['Buildings', `${grouped(s.buildings)}${s.estimated ? ` (${grouped(s.estimated)} est.)` : ''}`],
      ['Roads', fmtFt(s.roadsFt, 0)],
      ['Trees', grouped(s.trees)],
      ['Ground', `${grouped(s.groundMin, 1)} to ${grouped(s.groundMax, 1)} ft`],
    ];
  }
  async function screenshot({ deliver = true } = {}) {
    const r = state.result;
    if (!r) return null;
    try {
      const blob = await Scene.capture({ title: state.typed || r.loc.label, date: true, metrics: overlayMetrics(r), mark: 'CMRLM', theme: prefersDark() ? 'dark' : 'light' }, 2);
      if (deliver) {
        const res = await ShotMod.deliverImage(blob, ShotMod.screenshotFilename(slugOf(r)));
        if (res === 'downloaded') Toast.show('Image saved to your downloads.');
      }
      return blob;
    } catch (e) { console.error(e); Toast.show(e && e.message ? e.message : 'The image could not be made.', 'bad', 6000); return null; }
  }

  /* ---- Google Maps ------------------------------------------------------------------------------------ */
  function currentPoint() {
    const typed = parseCoordinates(els.addr.value);
    if (typed) return typed;
    return state.result ? { lat: state.result.loc.lat, lon: state.result.loc.lon } : null;
  }
  function openMaps() {
    const p = currentPoint();
    if (!p) return;
    window.open(googleMapsUrl(p.lat, p.lon), '_blank', 'noopener');
  }
  function syncActions() {
    const has = !!state.result;
    els.btnMaps.disabled = !currentPoint();
    els.btnDl.disabled = !has || state.busy;
    els.btnShot.disabled = !has || state.busy;
    els.btnFit.disabled = els.btnPlan.disabled = !has;
  }

  /* ---- DOM ---------------------------------------------------------------------------------------------- */
  const tbBtn = (id, icon, text, title, onclick, extra) => h('button', { class: 'btn has-text', type: 'button', id, title, 'aria-label': title, onclick, ...extra },
    h('span', { html: icon, style: 'display:contents' }), h('span', { class: 'btn-text' }, text));

  function buildTopbar() {
    els.btnMaps = tbBtn('btnMaps', ICONS.map, 'Google Maps', 'Open this place in Google Maps (a visual reference)', openMaps);
    els.btnDl = tbBtn('btnDownloads', ICONS.download, 'Downloads', 'Downloads: Revit CSV, DXF, Notes', openDownloads, { 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    els.btnDl.append(h('span', { html: ICONS.chev, style: 'display:contents' }));
    els.btnShot = tbBtn('btnShot', ICONS.camera, 'Screenshot', 'Save a picture of the 3D view', () => screenshot());
    $('tbActions').append(els.btnMaps, els.btnDl, els.btnShot);
  }

  function toggleRow(key, label) {
    const b = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!state.layers[key]), 'data-layer': key, onclick: () => toggleLayer(key, !state.layers[key]) },
      h('span', null, label), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    return b;
  }
  function seg(values, attr, label, current, onPick, labels) {
    const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    for (const v of values) g.append(h('button', { type: 'button', [`data-${attr}`]: v, 'aria-pressed': String(v === current), onclick: () => onPick(v) }, labels(v)));
    return g;
  }

  function buildPanel() {
    const sections = $('sections');

    // Site
    els.addr = h('input', { class: 'field', id: 'addr', type: 'text', placeholder: '3615 W Cypress St, Tampa, FL', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Address, coordinates, or Google Maps link', 'aria-describedby': 'addrHint' });
    els.go = h('button', { class: 'btn solid', type: 'button', id: 'goBtn', onclick: () => go() }, 'Go');
    els.addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); els.addr.blur(); go(); } });
    els.addr.addEventListener('input', syncActions);
    els.size = h('select', { id: 'sizeSel', 'aria-label': 'Site size' }, CONFIG.sizes.map((s) => h('option', { value: String(s) }, `${grouped(s)} ft`)));
    els.size.value = String(state.size);
    els.size.addEventListener('change', () => { state.size = Number(els.size.value); });
    els.recents = h('div', { class: 'recents' });
    els.recentsWrap = h('div', null, h('div', { class: 'label', style: 'padding:10px 0 2px' }, 'Recent sites'), els.recents);
    sections.append(h('div', { class: 'sec' },
      h('div', { class: 'label' }, 'Location'),
      h('div', { class: 'addr-row' }, els.addr, els.go),
      h('p', { class: 'help', id: 'addrHint' }, 'Address, lat/lon, or a Google Maps link'),
      h('div', { class: 'select-row' }, h('label', { for: 'sizeSel' }, 'Site size (square)'), els.size),
      els.recentsWrap));

    // Progress
    els.steps = h('ul', { class: 'steps', id: 'steps' }, CONFIG.steps.map(([k, label]) =>
      h('li', { 'data-step': k, 'data-s': 'pending' }, h('span', { class: 'ic' }), h('span', null, h('span', { class: 'nm' }, label), h('span', { class: 'ms' }, 'Waiting')))));
    els.elapsed = h('span', { class: 'aside', id: 'elapsed' });
    els.progressHead = h('button', { class: 'label sec-head', type: 'button', id: 'progressHead', 'aria-expanded': 'true', onclick: () => setProgressOpen(els.progressHead.getAttribute('aria-expanded') !== 'true') },
      h('span', { class: 'sec-title' }, h('span', { html: ICONS.chev, style: 'display:contents' }), 'Progress'), els.elapsed);
    els.progressSec = h('div', { class: 'sec', id: 'progressSec', hidden: true }, els.progressHead, els.steps);
    sections.append(els.progressSec);

    // Layers
    els.toggles = h('div', { class: 'toggles' }, CONFIG.layers.map(([k, l]) => toggleRow(k, l)));
    sections.append(h('div', { class: 'sec' }, h('div', { class: 'label' }, 'Layers'), els.toggles));

    // View
    els.scaleSeg = seg(CONFIG.scales, 'scale', 'Vertical scale', state.vscale, setVScale, (v) => `${v}×`);
    els.contourSeg = seg(CONFIG.contours, 'contour', 'Contour lines', state.contour, setContour, (v) => (v ? `${v} ft` : 'Off'));
    sections.append(h('div', { class: 'sec' }, h('div', { class: 'label' }, 'View'),
      h('div', { class: 'ctl-block' }, h('span', { class: 'ctl-label' }, 'Vertical scale'), els.scaleSeg),
      h('div', { class: 'ctl-block' }, h('span', { class: 'ctl-label' }, 'Contour lines'), els.contourSeg)));

    // Metrics
    els.metrics = h('div', { id: 'metrics' });
    sections.append(h('div', { class: 'sec' }, h('div', { class: 'label' }, 'Site data'), els.metrics));
    renderMetrics();

    sections.append(h('p', { class: 'credits' }, CREDITS));
  }

  function buildViews() {
    els.btnFit = h('button', { type: 'button', id: 'btnFit', 'aria-pressed': 'false', title: 'Fit the whole site in the view', onclick: () => Scene.fit(true) }, 'Fit');
    els.btnPlan = h('button', { type: 'button', id: 'btnPlan', 'aria-pressed': 'false', title: 'Look straight down', onclick: () => Scene.planView(true) }, 'Plan');
    $('views').append(els.btnFit, els.btnPlan);
    Scene.onPreset((p) => { els.btnFit.setAttribute('aria-pressed', String(p === 'fit')); els.btnPlan.setAttribute('aria-pressed', String(p === 'plan')); });
  }

  function buildCompass() {
    const rose = $('compassRose'), nLabel = $('compassN'), v = new THREE.Vector3(0, 0, -1);
    let last = NaN;
    Scene.onCamera((cam) => {
      v.set(0, 0, -1).transformDirection(cam.matrixWorldInverse);
      const a = Math.atan2(v.x, v.y);
      if (Math.abs(a - last) < 1e-3) return;
      last = a;
      rose.setAttribute('transform', `rotate(${(a * 180 / Math.PI).toFixed(1)} 24 24)`);
      nLabel.setAttribute('x', (24 + 17.6 * Math.sin(a)).toFixed(2));
      nLabel.setAttribute('y', (24 - 17.6 * Math.cos(a) + 2.4).toFixed(2));
    });
  }

  /* ---- bottom sheet (iPad portrait and phone) ------------------------------------------------------------- */
  function initSheet() {
    const app = $('app'), grabber = $('grabber');
    const GRAB = 44;
    const total = () => app.clientHeight;
    const lowest = () => GRAB + 40;
    const snaps = () => [lowest(), Math.round(total() * 0.42), Math.round(total() * 0.86)];
    const setH = (px) => app.style.setProperty('--sheet-h', `${Math.round(clamp(px, lowest(), total() * 0.9))}px`);
    const curH = () => $('panel').getBoundingClientRect().height;
    const animateTo = (to) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setH(to);
      const from = curH(), t0 = performance.now();
      const step = (now) => {
        const p = clamp((now - t0) / 180, 0, 1);
        setH(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    let drag = null;
    grabber.addEventListener('pointerdown', (e) => { grabber.setPointerCapture(e.pointerId); drag = { y: e.clientY, h: curH(), moved: false }; });
    grabber.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) setH(drag.h + dy);
    });
    const end = () => {
      if (!drag) return;
      const s = snaps(), now = curH();
      if (!drag.moved) animateTo(s.find((v) => v > now + 8) || s[0]);
      else animateTo(s.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a)));
      drag = null;
    };
    grabber.addEventListener('pointerup', end);
    grabber.addEventListener('pointercancel', end);
    grabber.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      setH(curH() + (e.key === 'ArrowUp' ? 60 : -60));
    });
    const reset = () => { if (sheetQuery.matches) setH(total() * 0.42); else app.style.removeProperty('--sheet-h'); };
    (sheetQuery.addEventListener ? sheetQuery.addEventListener('change', reset) : sheetQuery.addListener(reset));
    reset();
    window.addEventListener('resize', () => { if (sheetQuery.matches) { const px = parseFloat(app.style.getPropertyValue('--sheet-h')); if (px) setH(px); } });
  }

  function init() {
    els.viewport = $('viewport'); els.chip = $('statusChip'); els.empty = $('emptyState');
    buildTopbar();
    buildPanel();
    buildViews();
    initSheet();
    renderRecents();
    syncActions();
    return true;
  }

  return {
    init, go, buildCompass, screenshot, download, fileFor, toggleLayer, setVScale, setContour, setSize, openMaps, syncActions,
    state, els, metaOf, slugOf, renderMetrics, setStep,
  };
})();
