/* ==========================================================================
   TESTS: project file, placement, context from site, migration (docs/tower-project-sun-plan.md section 9.2)
   Open a project with a site, place the tower on it, load the neighbors, write the massing section (1 s debounce) and the sun
   section, keep every other section, the Mid-Rise replace question, a newer schema, Send to, import, close, and the schema 1 -> 2
   migration. A fixture project lives in an in-memory storage, so a ?test visit never touches the saved projects.
   runAllTests in 12b merges the results.
   ========================================================================== */
const ProjectFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const S = 1000, N = 11, SPACING = 100;
  /** A 1000 ft site square with a sloping ground (z = 1000 + 0.01 x + 0.02 y), a near building and a far one. */
  function siteProject({ withMassing = null, withPlates = false, withGrading = null, withSun = null } = {}) {
    let doc = ProjectMod.newProject({ name: 'Fixture', frame: { kind: 'site', lat: 33.927, lon: -84.339, size: S } });
    const points = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SPACING, j * SPACING, 1000 + 0.01 * i * SPACING + 0.02 * j * SPACING]);
    const derived = {
      address: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test',
      boundary: [[0, 0], [S, 0], [S, S], [0, S]], ground: { spacing: SPACING, n: N, points },
      buildings: [
        { id: 'near', outer: [[480, 380], [560, 380], [560, 420], [480, 420]], holes: [], base: 1010, height: 40, top: 1050, floors: 3, rule: 'data', name: 'Near' },
        { id: 'far', outer: [[950, 950], [990, 950], [990, 990], [950, 990]], holes: [], base: 1030, height: 30, top: 1060, floors: 2, rule: 'data', name: 'Far' },
      ],
      roads: { segments: [], pavement: [] }, walks: null, trees: [], water: { areas: [], lines: [] },
    };
    doc = ProjectMod.writeSection(doc, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { query: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test', walks: false }, derived });
    if (withMassing) doc = ProjectMod.writeSection(doc, 'massing', withMassing);
    if (withPlates) doc = ProjectMod.writeSection(doc, 'plates', { tool: 'plate', schema: 1, placement: { x: 1, y: 2, rotation: 0, baseZ: 3 }, state: { keep: 'me' }, derived: { levels: [] } });
    if (withGrading) doc = ProjectMod.writeSection(doc, 'grading', { tool: 'grading', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: withGrading });
    if (withSun) doc = ProjectMod.writeSection(doc, 'sun', withSun);
    return doc;
  }
  return { memory, siteProject, S };
})();

async function runProjectTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const near = (a, b, tol = 1e-9) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = (fn) => { const d0 = Store.historyDepth(); fn(); return Store.historyDepth() - d0; };

  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  const urls = [], navs = [];
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: (u) => navs.push(u), updateUrl: (id) => urls.push(id) });
  const stored = (id) => ProjectMod.loadProject(mem, id);
  const modal = () => document.querySelector('.modal-back');
  const answer = (yes) => { const m = modal(); if (!m) return false; const btns = m.querySelectorAll('.btn'); (yes ? btns[1] : btns[0]).click(); return true; };
  const fresh = () => { Store.replace(fillDefaults(defaultState()), { resetHistory: true }); };
  const towerMassing = (state, placement) => {
    const d = computeDerived(state);
    return { tool: 'tower', schema: 1, placement: placement || { x: 300, y: 400, rotation: 15, baseZ: 1020 }, state, derived: TowerDerivedMod.towerDerived(state, d, d.metrics) };
  };
  const midMassing = { tool: 'midrise', schema: 1, placement: { x: 500, y: 500, rotation: 0, baseZ: 1015 }, state: { mid: true }, derived: { levels: [] } };
  const sectionSchema = (id, key) => JSON.parse(mem.getItem(`cmrlm.project.${id}`)).sections[key];

  try {
    /* ---- the fixture and the schema ---- */
    await t('the fixture project is valid and carries a site', () => {
      const doc = ProjectFixture.siteProject();
      const v = ProjectMod.validate(doc);
      return (v.ok && !!ProjectMod.getSection(doc, 'site')) || v.errors.join('; ');
    });
    await t('the option state is schema 2 with placement null, context.fromSite false, radius 600 and the manual sun default', () => {
      const s = fillDefaults(defaultState());
      return eq([s.schema, CONFIG.schema, CONFIG.projectSchema, s.placement, s.context.fromSite, s.context.radius, s.sun.mode, s.sun.place.source, s.sun.dates, s.sun.times, s.sun.play],
        [2, 2, 1, null, false, 600, 'manual', 'default', ['03-20', '06-21', '12-21'], [540, 720, 900], false]);
    });
    await t('the Project site section is hidden while no project is open', () => {
      fresh();
      UI.setTab('site');
      const sec = document.querySelector('#tabpanel-site [data-section="project"]');
      return eq([ProjectUI.has(), !!sec, sec && sec.hidden], [false, true, true]);
    });

    /* ---- opening a project with a site and no massing ---- */
    await t('opening a site project with no massing centers the tower on the site, at the ground there, with the neighbors from the site', () => {
      fresh();
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const p = Store.get('placement'), ctx = Store.get('context');
      return eq([p.x, p.y, p.rotation, Math.round(p.baseZ), ctx.fromSite, ctx.blocks.length, ProjectUI.has(), ProjectUI.hasSite()], [500, 500, 0, 1015, true, 1, true, true]);
    });
    await t('the project name shows next to the Project button', () => {
      const pill = $('projPill');
      return eq([pill.hidden, pill.textContent], [false, 'Fixture']);
    });
    await t('the Project site section shows in the Site tab (first) with placement, Center on site and Context from site', () => {
      UI.setTab('site');
      const first = document.querySelector('#tabpanel-site .acc');
      const sec = document.querySelector('#tabpanel-site [data-section="project"]');
      const labels = [...document.querySelectorAll('#tabpanel-site [data-section="project"] .btn')].map((b) => b.textContent);
      const fields = [...document.querySelectorAll('#tabpanel-site [data-section="project"] .ctl-label')].map((l) => l.textContent).join('|');
      const ok = sec && !sec.hidden && first === sec && labels.includes('Center on site') && labels.includes('Context from site') && /X \(east\)/.test(fields) && /Rotation/.test(fields) && /Base elevation/.test(fields);
      return ok || `buttons ${labels}, first ${first && first.dataset.section}, fields ${fields}`;
    });
    await t('the site boundary is given in the tower frame (centered on the tower)', () => eq(ProjectUI.boundaryLocal(), [[-500, -500], [500, -500], [500, 500], [-500, 500]]));
    await t('the site layer draws the boundary and the north arrow', async () => {
      if (!Render.ready()) return true;
      await wait(250);
      const i = SiteLayer.info();
      return eq([i.shown, i.points], [true, 4]);
    });
    await t('the boundary follows the placement (moved 100 ft east: its west edge is at x = -400)', () => {
      Store.set('placement.x', 600, { live: false });
      const ring = ProjectUI.boundaryLocal();
      Store.set('placement.x', 500, { live: false });
      return eq(ring[0], [-600, -500]);
    });
    await t('the site layer hides with the context toggle, and with no project', async () => {
      if (!Render.ready()) return true;
      Store.set('context.show', false, { live: false });
      await wait(250);
      const hidden = SiteLayer.info().shown;
      Store.set('context.show', true, { live: false });
      await wait(250);
      return eq([hidden, SiteLayer.info().shown], [false, true]);
    });

    /* ---- context ---- */
    await t('Context from site: the radius picks the neighbors (100 ft: the near one; 2000 ft: both); blocks are in the tower frame', () => {
      const a = ProjectUI.contextFromSite(100, { quiet: true });
      const near1 = Store.get('context.blocks');
      const b = ProjectUI.contextFromSite(2000, { quiet: true });
      const both = Store.get('context.blocks');
      const first = both.find((x) => Math.abs(x.w - 80) < 0.1);
      return eq([a, near1[0].x, near1[0].y, near1[0].h, b, first && first.base, Store.get('context.radius'), Store.get('context.fromSite')], [1, 20, -100, 40, 2, -5, 2000, true]);
    });
    await t('Context from site is one undo step', () => eq(steps(() => ProjectUI.contextFromSite(150, { quiet: true })), 1));
    await t('Context from site replaces the manual blocks; with Keep manual blocks it adds to them', () => {
      Store.set('context.blocks', [{ x: 5, y: 5, w: 10, d: 10, h: 10 }], { live: false });
      ProjectUI.contextFromSite(100, { quiet: true, keepManual: false });
      const replaced = Store.get('context.blocks').map((b) => !!b.site);
      Store.set('context.blocks', [{ x: 5, y: 5, w: 10, d: 10, h: 10 }], { live: false });
      ProjectUI.contextFromSite(100, { quiet: true, keepManual: true });
      const kept = Store.get('context.blocks').map((b) => !!b.site);
      ProjectUI.contextFromSite(100, { quiet: true, keepManual: true });       // a second run does not stack the site blocks
      return eq([replaced, kept, Store.get('context.blocks').length], [[true], [false, true], 2]);
    });
    await t('moving the tower while the context comes from the site loads the neighbors again', () => {
      ProjectUI.contextFromSite(100, { quiet: true, keepManual: false });
      const n0 = Store.get('context.blocks').length;
      Store.set('placement.x', 900, { live: false });
      Store.set('placement.y', 900, { live: false });
      const n1 = Store.get('context.blocks').length;
      const far = Store.get('context.blocks')[0];
      Store.set('placement', { x: 500, y: 500, rotation: 0, baseZ: 1015 }, { live: false });
      return eq([n0, n1, far && Math.round(far.x)], [1, 1, 70]);
    });
    await t('Center on site puts the tower at the site center and the ground height (one undo step, neighbors included)', () => {
      Store.set('placement', { x: 10, y: 20, rotation: 0, baseZ: 0 }, { live: false });
      let ok;
      const n = steps(() => { ok = ProjectUI.centerOnSite({ quiet: true }); });
      const p = Store.get('placement');
      return eq([ok, p.x, p.y, Math.round(p.baseZ), n, Store.get('context.blocks').length], [true, 500, 500, 1015, 1, 1]);
    });
    await t('the ground height is read from the site grid (bilinear)', () => eq([Math.round(ProjectUI.groundAt(250, 130) * 100) / 100, Math.round(ProjectUI.groundAt(0, 0))], [1005.1, 1000]));

    /* ---- writing the massing section ---- */
    await t('flush writes the massing section: tool tower, schema 1, placement, schema 2 state, and a derived that validates', () => {
      Store.set('segments.0.floors', 14, { live: false });
      const res = ProjectUI.flush();
      const doc = stored(ProjectUI.doc().id);
      const sec = ProjectMod.getSection(doc, 'massing');
      const v = ProjectMod.validate(doc);
      return (res.ok !== false && v.ok && sec && sec.tool === 'tower' && sec.schema === 1 && sec.state.schema === 2 && sec.state.segments[0].floors === 14 && sec.placement.x === 500
        && sec.derived.metrics.floors === 14 && sec.derived.levels.length === 14 && !ProjectMod.getSection(doc, 'sun'))
        || `res ${JSON.stringify(res)} valid ${v.ok} ${v.errors} sec ${sec && JSON.stringify({ tool: sec.tool, schema: sec.schema, state: sec.state.schema, floors: sec.state.segments[0].floors, levels: sec.derived.levels.length })}`;
    });
    await t('the derived massing matches the design on screen (GFA from the levels equals the metrics GFA within 0.1 sf)', () => {
      const sec = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing');
      const sum = sec.derived.levels.filter((l) => l.zone !== 'crown').reduce((s, l) => s + Geo.multiPolyArea(l.plates), 0);
      return near(sum, Derived.get().metrics.gfa, 0.1);
    });
    await t('the project saves by itself about a second after a change (not before)', async () => {
      Store.set('segments.0.floors', 12, { live: false });
      await wait(300);
      const early = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.segments[0].floors;
      await wait(1100);
      const late = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.segments[0].floors;
      return eq([early, late, ProjectUI.status().dirty], [14, 12, false]);
    });
    await t('a live drag does not save until it is committed', async () => {
      Store.set('segments.0.shape.w', 120, { live: true });
      await wait(1200);
      const mid = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.segments[0].shape.w;
      Store.commit();
      await wait(1200);
      const end = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.segments[0].shape.w;
      return eq([mid, end], [100, 120]);
    });
    await t('writing keeps every other section and every unknown key (a round trip through the page)', () => {
      const doc = ProjectFixture.siteProject({ withPlates: true });
      doc.extra = { keep: 1 };
      ProjectMod.saveProject(mem, doc);
      const siteBefore = JSON.stringify(ProjectMod.getSection(doc, 'site')), platesBefore = JSON.stringify(ProjectMod.getSection(doc, 'plates'));
      ProjectUI.openDoc(doc);
      Store.set('segments.0.floors', 9, { live: false });
      ProjectUI.flush();
      const back = stored(doc.id);
      return eq([JSON.stringify(ProjectMod.getSection(back, 'site')) === siteBefore, JSON.stringify(ProjectMod.getSection(back, 'plates')) === platesBefore, back.extra, ProjectMod.getSection(back, 'massing').tool, back.log.at(-1).tool], [true, true, { keep: 1 }, 'tower', 'tower']);
    });
    await t('a save loads the project fresh: a section another tab saved in the meantime is kept', () => {
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const other = ProjectMod.writeSection(stored(doc.id), 'parking', { tool: 'parking', schema: 1, state: { other: true }, derived: { levels: [] } });
      ProjectMod.saveProject(mem, other);
      Store.set('segments.0.floors', 13, { live: false });
      ProjectUI.flush();
      const back = stored(doc.id);
      return eq([!!ProjectMod.getSection(back, 'parking'), ProjectMod.getSection(back, 'massing').state.segments[0].floors], [true, 13]);
    });
    await t('rename changes the project name in the file and the pill', () => {
      ProjectUI.rename('Fixture renamed');
      ProjectUI.flush();
      return eq([stored(ProjectUI.doc().id).name, $('projPill').textContent], ['Fixture renamed', 'Fixture renamed']);
    });

    /* ---- the Grading Sketch height ---- */
    await t('the Site tab names the Grading Sketch ground-floor height (the lowest massing tier) and says which one the tools read', () => {
      const doc = ProjectFixture.siteProject({ withGrading: { ffe: [{ id: 'massing-T2', source: 'massing', tier: 2, outer: [], ffe: 1018, padTop: 1017 }, { id: 'massing-T1', source: 'massing', tier: 1, outer: [], ffe: 1012, padTop: 1011 }, { id: 'p', source: 'parking', tier: 1, outer: [], ffe: 990, padTop: 989 }] } });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const tier = ProjectUI.gradingFfe(), text = $('ffeNote').textContent;
      return eq([tier && tier.ffe, /Grading Sketch sets the ground floor at 1,?012'-0"/.test(text)], [1012, true]);
    });
    await t('without a Grading Sketch tier the note says the base elevation is read', () => {
      ProjectUI.openDoc(ProjectFixture.siteProject());
      return eq([ProjectUI.gradingFfe(), /No Grading Sketch height yet/.test($('ffeNote').textContent)], [null, true]);
    });

    /* ---- loading a saved massing, and the migration ---- */
    await t('opening a project whose massing was written by the Tower Generator loads that design and placement', () => {
      fresh();
      const st = fillDefaults(CONFIG.presets.find((p) => p.id === 'hotel-podium').state);
      const doc = ProjectFixture.siteProject({ withMassing: towerMassing(st) });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      return eq([Store.get('segments').length, Store.get('podium.on'), Store.get('placement'), ProjectUI.status().replaceNeeded, Store.get('schema')], [st.segments.length, true, { x: 300, y: 400, rotation: 15, baseZ: 1020 }, false, 2]);
    });
    await t('a schema 1 option state loads as schema 2 and looks the same (same view.sun, same plates, manual sun)', () => {
      const old = deepClone(CONFIG.presets.find((p) => p.id === 'point-tower').state);
      delete old.placement; delete old.sun; delete old.context.fromSite; delete old.context.radius;
      old.schema = 1; old.view.sun = { azimuth: 200, altitude: 33 };
      const migrated = migrateTower(deepClone(old), 1);
      const s = fillDefaults(migrated);
      const same = JSON.stringify(Geo.buildPlates(s).plates.map((p) => [p.n, p.area])) === JSON.stringify(Geo.buildPlates(fillDefaults(old)).plates.map((p) => [p.n, p.area]));
      return eq([s.schema, s.placement, s.context.fromSite, s.context.radius, s.sun.mode, s.view.sun, same], [2, null, false, 600, 'manual', { azimuth: 200, altitude: 33 }, true]);
    });
    await t('the option storage migrates a saved schema 1 option on load (migrate passed to createStorage)', () => {
      const m = ProjectFixture.memory();
      const old = deepClone(CONFIG.presets.find((p) => p.id === 'office-slab').state);
      delete old.placement; delete old.sun; delete old.context.fromSite; delete old.context.radius;
      old.schema = 1;
      const a = StorageMod.createStorage({ key: 'migtest', schema: 1, storage: m, debounceMs: 0 });
      a.save(old, 'Old option'); a.flush();
      const b = StorageMod.createStorage({ key: 'migtest', schema: CONFIG.schema, migrate: migrateTower, storage: m });
      const rec = b.list()[0], st = rec && b.get(rec.id).state;
      return eq([st && st.schema, st && st.placement, st && st.sun && st.sun.mode, st && st.context.radius, st && st.view.sun], [2, null, 'manual', 600, old.view.sun]);
    });
    await t('a massing section whose state is schema 1 opens as schema 2 with the manual sun', () => {
      fresh();
      const old = deepClone(CONFIG.presets.find((p) => p.id === 'office-slab').state);
      delete old.placement; delete old.sun; delete old.context.fromSite; delete old.context.radius;
      old.schema = 1;
      const doc = ProjectFixture.siteProject({ withMassing: { tool: 'tower', schema: 1, placement: { x: 1, y: 2, rotation: 0, baseZ: 3 }, state: old, derived: { levels: [] } } });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      return eq([Store.get('schema'), Store.get('sun.mode'), Store.get('placement'), Store.get('view.sun')], [2, 'manual', { x: 1, y: 2, rotation: 0, baseZ: 3 }, old.view.sun]);
    });
    await t('the sun animation is never loaded as playing', () => eq(fillDefaults({ ...defaultState(), sun: { ...defaultSun(), play: true } }).sun.play, false));

    /* ---- the sun section ---- */
    await t('with the Sun Study on, the sun section is written with the massing: tool tower, schema 1, identity placement, place, dates and samples', () => {
      fresh();
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('sun.mode', 'study', { live: false });
      ProjectUI.flush();
      const back = stored(doc.id), sec = ProjectMod.getSection(back, 'sun');
      const y = new Date().getFullYear();
      const d = sec && sec.derived;
      const noon = d && d.samples.find((s) => s.date === `${y}-03-20` && s.time === '12:00');
      const ok = sec && ProjectMod.validate(back).ok && sec.tool === 'tower' && sec.schema === 1 && JSON.stringify(sec.placement) === JSON.stringify({ x: 0, y: 0, rotation: 0, baseZ: 0 })
        && sec.state.mode === 'study' && sec.state.play === false
        && d.lat === 33.749 && d.lon === -84.388 && d.tzOffset === -4 && d.zone === 'us-eastern'
        && JSON.stringify(d.dates) === JSON.stringify([`${y}-03-20`, `${y}-06-21`, `${y}-12-21`]) && d.sunHours === null
        && noon && Math.abs(noon.altitude - 48.3) < 1 && Math.abs(noon.azimuth - 138.4) < 2 && ProjectMod.getSection(back, 'massing').tool === 'tower';
      return ok || `sec ${sec && JSON.stringify({ tool: sec.tool, state: sec.state.mode, d: d && { lat: d.lat, tz: d.tzOffset, dates: d.dates, noon } })}`;
    });
    await t('the samples cover every study date x time, plus each date hourly in daylight, without repeats', () => {
      const d = ProjectMod.getSection(stored(ProjectUI.doc().id), 'sun').derived;
      const keys = d.samples.map((s) => `${s.date} ${s.time}`);
      const study = ['09:00', '12:00', '15:00'].every((tm) => d.dates.every((dt) => keys.includes(`${dt} ${tm}`)));
      const hourly = d.samples.filter((s) => s.date.endsWith('-12-21') && s.altitude > 0).length;
      return eq([study, new Set(keys).size === keys.length, hourly >= 10 && hourly <= 12], [true, true, true]);
    });
    await t('the place follows the Sun settings: Site uses the project place, Typed uses its own numbers', () => {
      Store.set('sun.place', { source: 'site', lat: 0, lon: 0 }, { live: false });
      const site = ProjectUI.sunDerived();
      Store.set('sun.place', { source: 'typed', lat: 40, lon: -75 }, { live: false });
      const typed = ProjectUI.sunDerived();
      Store.set('sun.place', { source: 'default', lat: 33.749, lon: -84.388 }, { live: false });
      return eq([site.lat, site.lon, typed.lat, typed.lon], [33.927, -84.339, 40, -75]);
    });
    await t('writeSun stores a sun-hours result (rounded to 0.01 h) and null clears it; sunHoursStored reads it back', () => {
      const hours = Float32Array.from([1, 2.345, 3, 4, 5, 6.789]);
      const ok = ProjectUI.writeSun({ spacing: 10, n: 3, nx: 3, ny: 2, x0: 0, y0: 0, frame: 'project', date: '03-20', step: 30, hours });
      ProjectUI.flush();
      const sh = ProjectMod.getSection(stored(ProjectUI.doc().id), 'sun').derived.sunHours;
      const back = ProjectUI.sunHoursStored();
      const y = new Date().getFullYear();
      const first = eq([ok, sh.spacing, sh.nx, sh.ny, sh.frame, sh.date, sh.step, sh.hours, back && back.hours.length], [true, 10, 3, 2, 'project', `${y}-03-20`, 30, [1, 2.35, 3, 4, 5, 6.79], 6]);
      if (first !== true) return first;
      ProjectUI.writeSun(null);
      ProjectUI.flush();
      return eq(ProjectMod.getSection(stored(ProjectUI.doc().id), 'sun').derived.sunHours, null);
    });
    await t('a sun-hours result alone (manual mode) also writes the sun section; a result with the wrong size is refused', () => {
      fresh();
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      ProjectUI.writeSun({ spacing: 10, n: 2, nx: 2, ny: 2, x0: 0, y0: 0, frame: 'project', date: '03-20', step: 30, hours: [1, 2, 3] });     // 3 values for 4 nodes
      ProjectUI.flush();
      const refused = !ProjectMod.getSection(stored(doc.id), 'sun');
      ProjectUI.writeSun({ spacing: 10, n: 2, nx: 2, ny: 2, x0: 0, y0: 0, frame: 'project', date: '03-20', step: 30, hours: [1, 2, 3, 4] });
      ProjectUI.flush();
      const sec = ProjectMod.getSection(stored(doc.id), 'sun');
      return eq([refused, sec && sec.derived.sunHours.hours, Store.get('sun.mode')], [true, [1, 2, 3, 4], 'manual']);
    });
    await t('reopening the project keeps the stored sun hours until the Sun UI replaces them', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.openDoc(stored(id));
      Store.set('segments.0.floors', 8, { live: false });
      ProjectUI.flush();
      return eq(ProjectMod.getSection(stored(id), 'sun').derived.sunHours.hours, [1, 2, 3, 4]);
    });

    /* ---- the Mid-Rise massing question ---- */
    await t('a Mid-Rise massing is kept until you confirm; confirming replaces it with the tower', async () => {
      fresh();
      const doc = ProjectFixture.siteProject({ withMassing: midMassing });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const flagged = ProjectUI.status().replaceNeeded;
      Store.set('segments.0.floors', 3, { live: false });
      ProjectUI.flush();
      const asked = !!modal(), text = modal() ? modal().textContent : '';
      const untouched = ProjectMod.getSection(stored(doc.id), 'massing').tool;
      answer(true);
      await wait(50);
      const replaced = ProjectMod.getSection(stored(doc.id), 'massing').tool;
      return eq([flagged, asked, /Mid-Rise/.test(text), untouched, replaced], [true, true, true, 'midrise', 'tower']);
    });
    await t('the question is asked once: more edits before the answer do not open a second dialog', async () => {
      fresh();
      const doc = ProjectFixture.siteProject({ withMassing: midMassing });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('segments.0.floors', 3, { live: false });
      ProjectUI.flush();
      Store.set('segments.0.floors', 4, { live: false });
      ProjectUI.flush();
      const n = document.querySelectorAll('.modal-back').length;
      answer(false);
      await wait(50);
      return eq(n, 1);
    });
    await t('declining the question keeps the Mid-Rise massing and stops saving to the project', async () => {
      fresh();
      const doc = ProjectFixture.siteProject({ withMassing: midMassing });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('segments.0.floors', 3, { live: false });
      ProjectUI.flush();
      answer(false);
      await wait(50);
      Store.set('segments.0.floors', 2, { live: false });
      ProjectUI.flush();
      return eq([ProjectMod.getSection(stored(doc.id), 'massing').tool, ProjectUI.status().readOnly], ['midrise', true]);
    });
    await t('a massing section with a newer schema opens read-only and is never written', () => {
      fresh();
      const doc = ProjectFixture.siteProject();
      const newer = JSON.parse(JSON.stringify(doc));
      newer.sections.massing = { tool: 'tower', schema: 9, updatedAt: new Date().toISOString(), placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { from: 'future' }, derived: {} };
      mem.setItem(`cmrlm.project.${newer.id}`, JSON.stringify(newer));
      ProjectUI.openDoc(newer);
      Store.set('segments.0.floors', 3, { live: false });
      const res = ProjectUI.flush();
      return eq([ProjectUI.status().readOnly, sectionSchema(newer.id, 'massing').schema, res.skipped === true], [true, 9, true]);
    });
    await t('a sun section with a newer schema opens read-only too', () => {
      fresh();
      const doc = ProjectFixture.siteProject({ withSun: { tool: 'tower', schema: 7, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { future: true }, derived: {} } });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('segments.0.floors', 3, { live: false });
      const res = ProjectUI.flush();
      return eq([ProjectUI.status().readOnly, res.skipped === true, sectionSchema(doc.id, 'sun').schema], [true, true, 7]);
    });

    /* ---- new, send, import, close ---- */
    await t('New project (no site) holds the design with a zero placement and a local frame; the Site tab section shows', () => {
      ProjectUI.close();
      fresh();
      const doc = ProjectUI.create('Local one', { quiet: true });
      const back = stored(doc.id);
      const sec = document.querySelector('#tabpanel-site [data-section="project"]');
      return eq([back.frame.kind, back.name, ProjectMod.getSection(back, 'massing').tool, Store.get('placement'), urls.at(-1) === doc.id, sec && sec.hidden, ProjectUI.hasSite()], ['local', 'Local one', 'tower', { x: 0, y: 0, rotation: 0, baseZ: 0 }, true, false, false]);
    });
    await t('the Export menu has the three Send items, enabled', async () => {
      $('btnExport').click();
      await wait(60);
      const ids = ['miSendPlate', 'miSendFacade', 'miSendGrading'];
      const found = ids.map((id) => { const el = $(id); return el ? !el.disabled : null; });
      const text = ids.map((id) => ($(id) ? $(id).textContent : ''));
      Pop.close();
      return eq([found, /Plate Planner/.test(text[0]), /Facade Studio/.test(text[1]), /Grading Sketch/.test(text[2])], [[true, true, true], true, true, true]);
    });
    await t('Send to Plate Planner saves the project, logs the send, and opens ../plate/?project=<id>', async () => {
      navs.length = 0;
      const id = ProjectUI.doc().id;
      const url = await ProjectUI.send('plate');
      const back = stored(id);
      return eq([url, navs, back.log.at(-1).action, back.log.at(-1).note], [`../plate/?project=${encodeURIComponent(id)}`, [`../plate/?project=${encodeURIComponent(id)}`], 'send', 'tower → plate']);
    });
    await t('Send to Facade Studio opens ../facade/?project=<id>; Send to Grading Sketch opens ../grading/?project=<id>', async () => {
      navs.length = 0;
      const id = ProjectUI.doc().id;
      await ProjectUI.send('facade');
      await ProjectUI.send('grading');
      const log = stored(id).log.filter((l) => l.action === 'send').map((l) => l.note);
      return eq([navs, log.slice(-2)], [[`../facade/?project=${encodeURIComponent(id)}`, `../grading/?project=${encodeURIComponent(id)}`], ['tower → facade', 'tower → grading']]);
    });
    await t('Send with no project open makes one first; an unknown tool is refused', async () => {
      ProjectUI.close();
      fresh();
      navs.length = 0;
      const bad = await ProjectUI.send('nope');
      const url = await ProjectUI.send('facade');
      const id = ProjectUI.doc() && ProjectUI.doc().id;
      return eq([bad, !!id, url === `../facade/?project=${encodeURIComponent(id)}`, navs.length, ProjectMod.getSection(stored(id), 'massing').tool], [false, true, true, 1, 'tower']);
    });
    await t('Send writes the sun section too when the Sun Study is on', async () => {
      Store.set('sun.mode', 'study', { live: false });
      await ProjectUI.send('facade');
      const sec = ProjectMod.getSection(stored(ProjectUI.doc().id), 'sun');
      return eq([sec && sec.tool, sec && sec.derived.samples.length > 8], ['tower', true]);
    });
    await t('Import opens the imported project (a taken id becomes a copy named "(2)")', async () => {
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      const file = new Blob([JSON.stringify(doc)], { type: 'application/json' });
      const got = await ProjectUI.importFile(file);
      return eq([!!got, got && got.name, got && got.id !== doc.id, ProjectUI.doc().id === got.id, urls.at(-1) === got.id], [true, 'Fixture (2)', true, true, true]);
    });
    await t('Export names the file from the project name (the Export item is enabled with a project)', () => {
      const e = ProjectMod.exportProject(ProjectUI.doc());
      $('btnProject').click();
      const exp = document.querySelector('#projectMenu [data-proj="export"]');
      const enabled = exp && !exp.disabled;
      Pop.close();
      return eq([e.filename, enabled], ['fixture-2.cmrlm.json', true]);
    });
    await t('Close project forgets the project and clears the placement; the saved copy stays; the Site section hides', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.close();
      const sec = document.querySelector('#tabpanel-site [data-section="project"]');
      return eq([ProjectUI.has(), Store.get('placement'), Store.get('context.fromSite'), !!stored(id), $('projPill').hidden, sec && sec.hidden], [false, null, false, true, true, true]);
    });
    await t('the Project menu lists the saved projects to open', () => {
      $('btnProject').click();
      const opens = [...document.querySelectorAll('#projectMenu [data-proj="open"]')].length;
      const items = [...document.querySelectorAll('#projectMenu [data-proj]')].map((b) => b.dataset.proj);
      Pop.close();
      return opens > 0 && ['new', 'import', 'export', 'close'].every((k) => items.includes(k)) || `items ${items}`;
    });
  } finally {
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab);
    Options.holdAutosave(false);
  }
  return results;
}
