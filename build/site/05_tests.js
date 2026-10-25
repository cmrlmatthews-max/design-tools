/* ==========================================================================
   TESTS
   In-page tests. Run by adding ?test to the address. They build a tiny synthetic site
   (synthetic DEM and synthetic decoded tiles), run it through the model, the 3D scene
   and the export functions, and run the pipeline against a fake network. The result
   panel shows pass or fail for each test.
   ========================================================================== */
const SiteTests = (() => {
  const { makeFrame, tileToLonLat } = GeoMod;
  const { buildModel, summarize } = ModelMod;
  const { revitCsv, siteDxf, notesMarkdown, CREDITS } = ExportsMod;
  const { validateDoc } = SkFmt;

  const Z = 14, TX = 4437, TY = 6865, EXT = 4096;
  const [LON, LAT] = tileToLonLat(Z, TX, TY, EXT / 2, EXT / 2, EXT);       // centre of one z14 tile
  const SIZE = 1000;

  function synthetic() {
    const frame = makeFrame(LAT, LON, SIZE);
    const toTile = (x, y) => {
      const [lon, lat] = frame.toLonLat(x, y), n = 2 ** Z, s = Math.sin(lat * Math.PI / 180);
      const wx = (lon + 180) / 360 * n, wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
      return [Math.round((wx - TX) * EXT), Math.round((wy - TY) * EXT)];
    };
    const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    const ring = (pts, hole = false) => { let r = pts.map((p) => toTile(p[0], p[1])); if ((area(r) > 0) === hole) r = r.reverse(); return r; };
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const layers = {
      building: { extent: EXT, features: [
        { id: 'b-data', type: 3, properties: { height: 30, '@height_source': 'test' }, geometry: [ring(rect(300, 300, 360, 340))] },
        { id: 'b-floors', type: 3, properties: { num_floors: 4 }, geometry: [ring(rect(500, 300, 560, 360)), ] },
        { id: 'b-court', type: 3, properties: { height: 40 }, geometry: [ring(rect(600, 600, 700, 700)), ring(rect(630, 630, 670, 670), true)] },
        { id: 'b-est', type: 3, properties: {}, geometry: [ring(rect(200, 700, 240, 730))] },
        { id: 'b-out', type: 3, properties: { height: 10 }, geometry: [ring(rect(2000, 2000, 2040, 2030))] },
      ] },
      segment: { extent: EXT, features: [
        { id: 's1', type: 2, properties: { subtype: 'road', class: 'residential' }, geometry: [[toTile(0, 150), toTile(500, 160), toTile(1000, 150)]] },
        { id: 's2', type: 2, properties: { subtype: 'road', class: 'footway' }, geometry: [[toTile(100, 0), toTile(120, 500), toTile(110, 1000)]] },
      ] },
      land: { extent: EXT, features: [
        { id: 't1', type: 1, properties: { class: 'tree' }, geometry: [toTile(420, 420), toTile(440, 430)] },
        { id: 'f1', type: 3, properties: { subtype: 'forest', class: 'wood' }, geometry: [ring(rect(800, 100, 900, 200))] },
      ] },
      water: { extent: EXT, features: [
        { id: 'w1', type: 3, properties: { class: 'pond' }, geometry: [ring(rect(750, 750, 850, 830))] },
      ] },
    };
    const tiles = [{ z: Z, x: TX, y: TY, layers }];
    // synthetic DEM: a tilted plane with a bump, meters, row 0 = north
    const w = 120, hgt = 120, bb = frame.bbox(60), pixelW = (bb.east - bb.west) / w, pixelH = (bb.north - bb.south) / hgt;
    const data = new Float32Array(w * hgt);
    for (let r = 0; r < hgt; r++) for (let c = 0; c < w; c++) {
      const [x, y] = frame.toLocal(bb.west + (c + 0.5) * pixelW, bb.north - (r + 0.5) * pixelH);
      data[r * w + c] = (30 + 0.01 * x + 0.005 * y + 3 * Math.sin(x / 120) * Math.cos(y / 150)) * 0.3048;
    }
    return { frame, tiles, dem: { width: w, height: hgt, data, west: bb.west, north: bb.north, pixelW, pixelH } };
  }

  /** Minimal little-endian single-strip float32 GeoTIFF, for the fake network. */
  function encodeTiff(dem) {
    const { width, height, data } = dem;
    const entries = 12, ifdOff = 8 + data.byteLength, extraOff = ifdOff + 2 + entries * 12 + 4;
    const buf = new ArrayBuffer(extraOff + 72), dv = new DataView(buf);
    dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
    new Float32Array(buf, 8, data.length).set(data);
    const tags = [
      [256, 4, 1, width], [257, 4, 1, height], [258, 3, 1, 32], [259, 3, 1, 1], [273, 4, 1, 8], [277, 3, 1, 1],
      [278, 4, 1, height], [279, 4, 1, data.byteLength], [339, 3, 1, 3], [33550, 12, 3, extraOff], [33922, 12, 6, extraOff + 24],
    ];
    dv.setUint16(ifdOff, tags.length, true);
    tags.forEach(([tag, type, n, val], i) => {
      const e = ifdOff + 2 + i * 12;
      dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, n, true);
      if (type === 3) dv.setUint16(e + 8, val, true); else dv.setUint32(e + 8, val, true);
    });
    [dem.pixelW, dem.pixelH, 0, 0, 0, 0, dem.west, dem.north, 0].forEach((v, i) => dv.setFloat64(extraOff + i * 8, v, true));
    // bytes 0..23: ModelPixelScale; bytes 24..71: ModelTiepoint (I, J, K, X, Y, Z)
    return buf;
  }

  function fakeNet({ dem, demFails = false } = {}) {
    const calls = [];
    const fn = async (url) => {
      url = String(url); calls.push(url);
      if (url.includes('nominatim.openstreetmap.org')) return new Response(JSON.stringify([{ lat: String(LAT), lon: String(LON), display_name: 'Test Address, Tampa' }]), { status: 200 });
      if (url.includes('elevation.nationalmap.gov')) return demFails ? new Response('<html>error</html>', { status: 200 }) : new Response(encodeTiff(dem), { status: 200 });
      if (url.includes('list-type=2')) return new Response('<ListBucketResult><CommonPrefixes><Prefix>tiles/2026-10-14.0/</Prefix></CommonPrefixes></ListBucketResult>', { status: 200 });
      return new Response('', { status: 404 });                    // every .pmtiles request fails
    };
    fn.calls = calls;
    return fn;
  }

  async function run() {
    const results = [];
    const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
    const near = (a, b, tol = 1e-6) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
    const t = async (name, fn) => {
      let r;
      try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
      results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
    };

    const { frame, tiles, dem } = synthetic();
    let model = null;

    /* ---- model ---- */
    await t('ClipperLib is loaded', () => eq(typeof globalThis.ClipperLib, 'object'));
    await t('buildModel on the synthetic site: 4 buildings (one outside is dropped)', () => {
      model = buildModel(frame, { dem, tiles });
      return eq(model.buildings.length, 4);
    });
    await t('building height rules: data, floors, data, estimate', () => {
      const by = Object.fromEntries(model.buildings.map((b) => [b.id, b]));
      return eq([by['b-data'].rule, by['b-floors'].rule, by['b-court'].rule, by['b-est'].rule], ['data', 'floors', 'data', 'estimate']);
    });
    await t('building heights: 30 m, 4 floors, estimate', () => {
      const by = Object.fromEntries(model.buildings.map((b) => [b.id, b]));
      return eq([Math.round(by['b-data'].height * 10) / 10, by['b-floors'].height, by['b-est'].height], [98.4, 48, 24]);
    });
    await t('model has roads, trees, one water area and no errors', () => {
      const s = summarize(model);
      return eq([model.roads.segments.length > 0, model.roads.pavement.length > 0, s.trees >= 2, s.waterAreas, Object.keys(model.errors).length], [true, true, true, 1, 0]);
    });
    await t('walks are built on request from the cached tiles', () => {
      const roads = Pipeline.buildWalks({ tiles, frame, model });
      return eq([roads.walks && roads.walks.length > 0, model.roads.walks], [true, null]);
    });
    await t('ground grid is 96 by 96 for 1000 ft', () => eq([model.ground.n, model.ground.spacing], [96, 10.5]));

    /* ---- 3D scene ---- */
    await t('WebGL scene is available', () => Scene.ready() || 'no WebGL');
    await t('scene: setModel makes the expected buildings (4) in 2 meshes', () => {
      Scene.setModel(model);
      $('emptyState').hidden = true;
      const i = Scene.info();
      return eq([i.buildings, i.buildingMeshes], [4, 2]);
    });
    await t('scene: trees, water and road geometry exist', () => {
      const i = Scene.info();
      return eq([i.trees >= 2, i.waterAreas, i.roadTriangles > 0, i.walkTriangles], [true, 1, true, 0]);
    });
    await t('scene: the ground mesh surface equals the grid at a node', () => {
      const g = model.ground;
      return near(Scene.meshAt(g.xs[10], g.ys[20]), g.z[20 * g.n + 10], 1e-6);
    });
    await t('scene: the ground mesh surface is within 0.5 ft of the bilinear ground', () => {
      let worst = 0;
      for (const [x, y] of [[100.3, 200.7], [555.5, 301.2], [873.1, 64.9], [20, 960]]) worst = Math.max(worst, Math.abs(Scene.meshAt(x, y) - model.ground.at(x, y)));
      return worst < 0.5 || `worst ${worst}`;
    });
    await t('scene: vertical scale keeps the ground minimum fixed', () => {
      Scene.setVScale(3);
      const root = Scene.groups().ground.parent;
      const r = near(root.position.y + model.ground.min * root.scale.y, model.ground.min, 1e-6);
      Scene.setVScale(1);
      return r;
    });
    await t('scene: layer toggles', () => {
      Scene.setLayer('buildings', false); const off = Scene.groups().buildings.visible;
      Scene.setLayer('buildings', true); const on = Scene.groups().buildings.visible;
      return eq([off, on], [false, true]);
    });
    await t('scene: contour setting', () => {
      Scene.setContour(5); const a = Scene.info().contour; Scene.setContour(0);
      return eq([a, Scene.info().contour], [5, 0]);
    });
    await t('scene: renders without a GL error', () => {
      Scene.renderNow();
      const gl = Scene.camera() && document.querySelector('#canvasHost canvas').getContext('webgl2');
      return !gl || gl.getError() === 0 || `gl error ${gl.getError()}`;
    });

    /* ---- exports ---- */
    const meta = { address: 'Test Address', lat: LAT, lon: LON, size: SIZE, release: '2026-10-14.0', date: '2026-10-21' };
    await t('CSV has n*n rows', () => {
      const rows = revitCsv(model.ground).trim().split('\n');
      return eq(rows.length, model.ground.n * model.ground.n);
    });
    await t('DXF starts with a SECTION and ends with EOF', () => {
      const dxf = siteDxf(model);
      return eq([dxf.startsWith('  0\nSECTION'), dxf.trimEnd().endsWith('EOF')], [true, true]);
    });
    await t('DXF has the building layers', () => {
      const dxf = siteDxf(model);
      return eq(['BLDG-DATA', 'BLDG-ESTIMATE', 'TOPO-MESH', 'ROAD-PAVEMENT', 'WATER', 'TREE'].map((l) => dxf.includes(l)), [true, true, true, true, true, true]);
    });
    await t('notes mention the address, the release and the credits', () => {
      const md = notesMarkdown(model, meta);
      return eq([md.includes('Test Address'), md.includes('2026-10-14.0'), md.includes(CREDITS)], [true, true, true]);
    });
    await t('download names: slug from address and size', () => {
      const keep = App.state.typed;
      App.state.typed = '3615 W Cypress St, Tampa, FL';
      const r = { frame, loc: { label: 'x' } };
      const a = App.fileFor('csv', { ...r, model }).name, b = App.fileFor('dxf', { ...r, model }).name, c = App.fileFor('notes', { ...r, model, release: 'x', loc: { lat: LAT, lon: LON, label: 'x' } }).name;
      App.state.typed = keep;
      return eq([a, b, c], ['3615-w-cypress-st-tampa-fl-1000ft-topo.csv', '3615-w-cypress-st-tampa-fl-1000ft-site.dxf', '3615-w-cypress-st-tampa-fl-1000ft-notes.md']);
    });

    /* ---- SketchUp export ---- */
    const skResult = () => ({ frame, model, release: '2026-10-14.0', loc: { lat: LAT, lon: LON, label: 'Test Address' } });
    await t('SketchUp: the Downloads menu has a SketchUp button', () => {
      Pop.close();
      App.openDownloads();
      const b = document.querySelector('[data-dl="sketchup"]');
      const r = eq([!!b, b && b.textContent.includes('SketchUp'), !!document.querySelector('[data-dl="csv"]'), !!document.querySelector('[data-dl="dxf"]')], [true, true, true, true]);
      Pop.close();
      return r;
    });
    await t('SketchUp: the document validates (ground triangles, buildings, no trees)', () => {
      const keep = App.state.typed;
      App.state.typed = 'Test Address';
      const d = App.sketchupDoc(skResult());
      App.state.typed = keep;
      const hasTreeNode = (nd) => /tree/i.test(nd.name) || (nd.children || []).some(hasTreeNode);
      const v = validateDoc(d), n = model.ground.n, find = (name) => d.root.children.find((c) => c.name === name);
      if (!v.ok) return v.errors.join('; ');
      return eq([d.source, d.root.name, find('Ground').triangles.length, find('Buildings').children.length, hasTreeNode(d.root), d.zShift === Math.round(-model.ground.min * 100) / 100],
        ['site', 'Site at Test Address', 2 * (n - 1) * (n - 1), 4, false, true]);
    });
    await t('SketchUp: the download name is slug + size + date, and the file is JSON', () => {
      const keep = App.state.typed;
      App.state.typed = '3615 W Cypress St, Tampa, FL';
      const f = App.fileFor('sketchup', skResult());
      App.state.typed = keep;
      return eq([/^3615-w-cypress-st-tampa-fl-1000ft-\d{4}-\d{2}-\d{2}\.sketchup\.json$/.test(f.name), f.blob.type, f.blob.size > 1000], [true, 'application/json', true]);
    });

    /* ---- pipeline on a fake network ---- */
    await t('pipeline: ground loads, all three map themes fail, the run still finishes', async () => {
      const log = [];
      const r = await Pipeline.run({ text: 'Test Address', size: SIZE }, (s, st, m) => log.push([s, st, m]), { fetchFn: fakeNet({ dem }) });
      const last = (s) => log.filter((e) => e[0] === s).pop()[1];
      return eq([r.model.ground.n, r.release, r.failed, last('ground'), last('address'), last('release'), last('buildings'), last('roads'), last('base')],
        [96, '2026-10-14.0', ['buildings', 'roads', 'base'], 'done', 'done', 'done', 'error', 'error', 'error']);
    });
    await t('pipeline: a ground failure stops with a clear message', async () => {
      const log = [];
      let msg = '';
      try { await Pipeline.run({ text: 'Test Address', size: SIZE }, (s, st, m) => log.push([s, st, m]), { fetchFn: fakeNet({ dem, demFails: true }) }); } catch (e) { msg = e.message; }
      const ground = log.filter((e) => e[0] === 'ground').pop();
      return eq([msg.startsWith('Ground elevation could not be loaded.'), ground[1]], [true, 'error']);
    });
    await t('pipeline: coordinates skip the address service', async () => {
      const net = fakeNet({ dem });
      await Pipeline.run({ text: `${LAT.toFixed(5)}, ${LON.toFixed(5)}`, size: SIZE }, () => {}, { fetchFn: net });
      return eq(net.calls.some((u) => u.includes('nominatim')), false);
    });

    /* ---- screenshot ---- */
    await t('screenshot: the shared capture returns a PNG with the overlay', async () => {
      const keep = App.state.result;
      App.state.result = { model, frame, loc: { lat: LAT, lon: LON, label: 'Test Address' }, release: 'x' };
      const blob = await App.screenshot({ deliver: false });
      App.state.result = keep;
      return eq([blob && blob.type, blob && blob.size > 2000], ['image/png', true]);
    });

    /* ---- project file (an in-memory storage object; the real localStorage is never used) ---- */
    const memStorage = () => {
      const m = new Map();
      return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, keys: () => [...m.keys()] };
    };
    const { siteDerived, siteState } = SiteDerivedMod;
    const pmeta = { address: 'Test Address', lat: LAT, lon: LON, size: SIZE, release: '2026-10-14.0', walks: false };
    const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    const allNumbers = (v, out = []) => { if (typeof v === 'number') out.push(v); else if (Array.isArray(v)) v.forEach((x) => allNumbers(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => allNumbers(x, out)); return out; };
    const siteProjectDoc = (stateOverride) => {
      const fresh = ProjectMod.newProject({ name: 'Test project', frame: { kind: 'site', lat: LAT, lon: LON, size: SIZE, zDatum: 'NAVD88' } });
      // writeSection returns a new document and leaves its input unchanged (spec section 10).
      return ProjectMod.writeSection(fresh, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: siteState({ ...pmeta, ...stateOverride }), derived: siteDerived(model, pmeta), note: 'Test Address, 1,000 ft' });
    };
    const fakeResult = () => ({ model, frame, loc: { lat: LAT, lon: LON, label: 'Test Address' }, release: '2026-10-14.0' });
    /** Runs fn with an in-memory storage, no navigation, a fake result on screen and no open project; puts everything back afterwards. */
    const inProject = async (fn) => {
      const P = App.project, keep = { storage: P.storage, navigate: P.navigate, updateUrl: P.updateUrl, noted: P.noted, result: App.state.result, typed: App.state.typed, addr: $('addr').value, size: App.state.size };
      const mem = memStorage(), urls = [];
      App.projectClose();
      Object.assign(P, { storage: mem, navigate: (u) => urls.push(u), updateUrl: () => {}, noted: {} });
      App.state.result = fakeResult(); App.state.typed = ''; App.syncActions();
      try { return await fn(mem, urls); } finally {
        App.projectClose();
        Object.assign(P, { storage: keep.storage, navigate: keep.navigate, updateUrl: keep.updateUrl, noted: keep.noted });
        App.state.result = keep.result; App.state.typed = keep.typed; $('addr').value = keep.addr; App.setSize(keep.size); App.syncActions();
        $('toasts').textContent = '';
      }
    };

    let pd = null;
    await t('project: siteDerived on the synthetic site has the boundary and n * n ground points', () => {
      pd = siteDerived(model, pmeta);
      const n = model.ground.n;
      return eq([pd.boundary, pd.ground.n, pd.ground.points.length, pd.ground.points[1][0], pd.address, pd.size, pd.release],
        [[[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]], n, n * n, model.ground.spacing, 'Test Address', SIZE, '2026-10-14.0']);
    });
    await t('project: siteDerived ground runs row-major from the south', () => {
      const g = model.ground, n = g.n, p = pd.ground.points;
      return eq([p[0].slice(0, 2), p[n].slice(0, 2), p[n * n - 1].slice(0, 2), Math.abs(p[n + 2][2] - g.z[n + 2]) <= 0.005 + 1e-9],
        [[0, 0], [0, g.spacing], [g.xs[n - 1], g.ys[n - 1]], true]);
    });
    await t('project: siteDerived buildings (4): outer rings counter-clockwise, the courtyard hole clockwise', () => {
      const court = pd.buildings.find((b) => b.id === 'b-court');
      return eq([pd.buildings.length, pd.buildings.every((b) => ringArea(b.outer) > 0), court.holes.length, ringArea(court.holes[0]) < 0, pd.buildings.map((b) => b.rule).join()],
        [4, true, 1, true, 'data,floors,data,estimate']);
    });
    await t('project: siteDerived roads, trees and water; every number is finite; the data is plain JSON', () => {
      const nums = allNumbers(pd);
      return eq([pd.roads.segments.length > 0, pd.roads.pavement.length > 0, pd.trees.length >= 2, pd.water.areas.length, pd.walks, nums.every(Number.isFinite), nums.length > model.ground.n * model.ground.n * 3, JSON.stringify(JSON.parse(JSON.stringify(pd))) === JSON.stringify(pd)],
        [true, true, true, 1, null, true, true, true]);
    });
    await t('project: siteState has query, lat, lon, size, release and walks', () => eq(siteState({ ...pmeta, walks: true }),
      { query: 'Test Address', lat: LAT, lon: LON, size: SIZE, release: '2026-10-14.0', walks: true, removed: [] }));
    await t('project: writeSection, validate, saveProject and loadProject keep the site section (in memory)', () => {
      const mem = memStorage(), doc = siteProjectDoc();
      const v = ProjectMod.validate(doc);
      if (!v.ok) return `validate: ${v.errors.join('; ')}`;
      const saved = ProjectMod.saveProject(mem, doc), back = ProjectMod.loadProject(mem, doc.id);
      const sec = back && ProjectMod.getSection(back, 'site');
      return eq([saved.ok, !!sec, sec && JSON.stringify(sec.derived) === JSON.stringify(pd), sec && sec.state.query, mem.keys().some((k) => k.startsWith('cmrlm.project.')), ProjectMod.listProjects(mem).length],
        [true, true, true, 'Test Address', true, 1]);
    });

    await t('project: the top bar has the Project button and both Send buttons', () => eq(
      [!!$('btnProject'), !!$('btnSendTower'), !!$('btnSendMidrise'), $('btnSendTower').textContent, $('btnSendMidrise').textContent, !!$('projFile')],
      [true, true, true, 'Send to Tower Generator', 'Send to Mid-Rise Generator', true]));
    await t('project: both Send buttons are off before a run and on after one', () => inProject(() => {
      App.state.result = null; App.syncActions();
      const before = [$('btnSendTower').disabled, $('btnSendMidrise').disabled];
      App.state.result = fakeResult(); App.syncActions();
      return eq([before, $('btnSendTower').disabled, $('btnSendMidrise').disabled], [[true, true], false, false]);
    }));
    await t('project: the Project menu has New project, Open, Import and Export (Export is off without a project)', () => inProject((mem) => {
      ProjectMod.saveProject(mem, siteProjectDoc());
      App.openProjectMenu();
      const q = (k) => document.querySelector(`#projectMenu [data-proj="${k}"]`);
      const r = eq([!!q('new'), !!q('import'), !!q('export'), q('export').disabled, document.querySelectorAll('#projectMenu [data-proj="open"]').length, document.querySelector('#projectMenu [data-proj="open"]').textContent.includes('Test project')],
        [true, true, true, true, 1, true]);
      Pop.close();
      return r;
    }));
    await t('project: New project makes a site project with the site section and shows its name', () => inProject((mem) => {
      const doc = App.projectCreate('Ravinia test');
      const sec = doc && ProjectMod.getSection(doc, 'site'), stored = doc && ProjectMod.loadProject(mem, doc.id);
      return eq([!!doc, doc.frame.kind, doc.frame.size, doc.frame.zDatum, sec && sec.derived.ground.n, sec && sec.state.query, !!stored && !!ProjectMod.getSection(stored, 'site'), $('projPill').hidden, $('projPill').textContent],
        [true, 'site', SIZE, 'NAVD88', model.ground.n, 'Test Address', true, false, 'Project: Ravinia test']);
    }));
    await t('project: New project without a site makes a local project; the first run gives it the site frame', () => inProject((mem) => {
      App.state.result = null; App.syncActions();
      const doc = App.projectCreate('No site yet');
      const local = [doc.frame.kind, doc.frame.zDatum, !!ProjectMod.getSection(doc, 'site'), !!ProjectMod.loadProject(mem, doc.id)];
      App.state.result = fakeResult();
      const wrote = App.projectWrite(), saved = App.flushProject();      // the flush writes the section on a new copy and adopts the site frame
      const now = App.project.doc;
      return eq([local, wrote, saved.ok, now.frame.kind, now.frame.size, now.frame.zDatum, !!ProjectMod.getSection(now, 'site')], [['local', 'local', false, true], true, true, 'site', SIZE, 'NAVD88', true]);
    }));
    await t('project: Send to Tower Generator makes a project named after the address and goes to ../tower/?project=<id>', () => inProject(async (mem, urls) => {
      App.state.typed = 'Test Address';
      await App.projectSend('tower');
      const doc = App.project.doc, stored = doc && ProjectMod.loadProject(mem, doc.id);
      const last = doc && doc.log[doc.log.length - 1];
      return eq([!!doc, doc.name, urls.length, urls[0], !!stored && !!ProjectMod.getSection(stored, 'site'), last && last.action], [true, 'Test Address', 1, `../tower/?project=${doc.id}`, true, 'send']);
    }));
    await t('project: Send to Mid-Rise Generator goes to ../midrise/?project=<id>', () => inProject(async (mem, urls) => {
      App.state.typed = 'Test Address';
      await App.projectSend('midrise');
      const doc = App.project.doc;
      return eq([!!doc, urls.length, urls[0]], [true, 1, `../midrise/?project=${doc.id}`]);
    }));
    await t('project: Send to an unknown tool does nothing', () => inProject(async (mem, urls) => {
      const r = await App.projectSend('nowhere');
      return eq([r, urls.length, App.project.doc, mem.keys().length], [false, 0, null, 0]);
    }));
    await t('project: a run does not touch storage when no project is open', () => inProject((mem) => {
      const wrote = App.projectWrite();
      App.flushProject();
      return eq([wrote, mem.keys().length, App.project.doc], [false, 0, null]);
    }));
    await t('project: a project with a saved site fills the address and size, and the run request', () => inProject(() => {
      const doc = siteProjectDoc({ address: 'Saved Address', size: 1500, walks: false });
      App.openProjectDoc(doc);
      const req = App.siteRequest(doc);
      return eq([req.text, req.size, req.loc.lat, req.loc.lon, $('addr').value, $('sizeSel').value, $('projPill').textContent],
        ['Saved Address', 1500, LAT, LON, 'Saved Address', '1500', 'Project: Test project']);
    }));
    await t('project: a project without a site section gives no run request', () => inProject(() => {
      const doc = ProjectMod.newProject({ name: 'Empty' });
      App.openProjectDoc(doc);
      return eq([App.siteRequest(doc), App.project.readOnly], [null, false]);
    }));
    await t('project: a site section with a newer schema opens read only and is never written', () => inProject((mem) => {
      const doc = ProjectMod.writeSection(siteProjectDoc(), 'site', { tool: 'site', schema: 2, state: { query: 'Newer' }, derived: {} });
      const before = JSON.stringify(doc);
      App.openProjectDoc(doc);
      const wrote = App.projectWrite(), saved = App.flushProject();
      return eq([App.project.readOnly, wrote, JSON.stringify(doc) === before, saved.ok, mem.keys().length, $('projPill').textContent.includes('read only')], [true, false, true, true, 0, true]);
    }));
    await t('project: a write is saved one second later, not at once', () => inProject(async (mem) => {
      const doc = App.projectCreate('Autosave');
      const key = `cmrlm.project.${doc.id}`;
      mem.removeItem(key);
      App.projectWrite(); App.scheduleProjectSave();
      const at0 = mem.getItem(key);
      await new Promise((r) => setTimeout(r, CONFIG.projectSaveMs + 250));
      return eq([at0, !!mem.getItem(key), CONFIG.projectSaveMs], [null, true, 1000]);
    }));

    /* ---- trees off (docs/batch-fixes-technical-plan.md section 6): the Site Model makes no trees for now; the tree code stays ---- */
    /** The synthetic site on screen as a loaded result (the panel reads state.result); puts the panel back afterwards. */
    const withResult = (fn) => inProject(async () => { Scene.setModel(model); App.renderMetrics(); try { return await fn(); } finally { App.renderMetrics(); } });
    await t('trees: CONFIG.trees is { generate: false, exports: false }; buildModel with trees: false (what the pipeline passes) builds none, and trees: true still builds them', () => {
      const off = buildModel(frame, { dem, tiles, trees: CONFIG.trees.generate }), forced = buildModel(frame, { dem, tiles, trees: true });
      return eq([CONFIG.trees, off.trees.length, summarize(off).trees, off.errors.trees === undefined, forced.trees.length >= 2], [{ generate: false, exports: false }, 0, 0, true, true]);
    });
    await t('trees: a model without trees draws no tree meshes and siteDerived gives trees []', () => {
      const off = buildModel(frame, { dem, tiles, trees: false });
      Scene.setModel(off);
      const drawn = [Scene.info().trees, Scene.groups().trees.children.length];
      Scene.setModel(model);
      return eq([drawn, siteDerived(off, pmeta).trees], [[0, 0], []]);
    });
    await t('trees: the Trees layer toggle, the Site data row, the overlay line, the DXF menu text and the credits leave the panel', () => withResult(() => {
      App.openDownloads();
      const dxfText = (document.querySelector('[data-dl="dxf"]') || { textContent: 'missing' }).textContent;
      Pop.close();
      const metricsText = $('metrics').textContent;
      return eq([!!document.querySelector('[data-layer="trees"]'), !!document.querySelector('[data-layer="water"]'), /trees/i.test(metricsText), /water areas/i.test(metricsText), /trees/i.test(dxfText), /trees/i.test(document.querySelector('.credits').textContent)],
        [false, true, false, true, false, false]);
    }));
    await t('trees: with exports off the DXF and the notes leave trees out even for a model that carries trees; with exports on they come back', () => withResult(() => {
      const r = App.state.result, pick = () => [App.fileFor('dxf', r).text.includes('TREE'), App.fileFor('notes', r).text.includes('- Trees:'), App.fileFor('notes', r).text.includes(CREDITS)];
      const was = CONFIG.trees.exports;
      let off, on;
      try { off = pick(); CONFIG.trees.exports = true; on = pick(); } finally { CONFIG.trees.exports = was; }
      return eq([r.model.trees.length >= 2, off, on], [true, [false, false, false], [true, true, true]]);
    }));
    await t('trees: a model without trees has no TREE layer in the DXF, no Trees line in the notes and no "trees" in the credits; a model with trees keeps all three', () => {
      const off = buildModel(frame, { dem, tiles, trees: false });
      const dOff = siteDxf(off), dOn = siteDxf(model), nOff = notesMarkdown(off, meta), nOn = notesMarkdown(model, meta);
      return eq([dOff.includes('TREE'), dOn.includes('TREE'), nOff.includes('- Trees:'), nOn.includes('- Trees:'), nOff.includes(ExportsMod.CREDITS_NO_TREES), /trees/i.test(ExportsMod.CREDITS_NO_TREES), nOn.includes(CREDITS)],
        [false, true, false, true, true, false, true]);
    });

    /* ---- remove existing buildings (docs/site-remove-technical-plan.md, section 7.2) ---- */
    const bById = (id) => model.buildings.find((b) => b.id === id);
    const ptOf = (id, top = true) => {                       // client point of the middle of a building (roof or ground)
      const b = bById(id), xs = b.ring.map((q) => q[0]), ys = b.ring.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return Scene.screenOf(cx, cy, top ? b.top : Scene.meshAt(cx, cy));
    };
    const groundPt = (x, y) => Scene.screenOf(x, y, Scene.meshAt(x, y));
    const canvasEl = () => document.querySelector('#canvasHost canvas');
    /** pointerdown + pointerup as a finger would send them. They go to the canvas host (the parent of the canvas): OrbitControls listens on the canvas itself
        and would throw on a pointer id that the browser does not know. A real mouse click on the canvas reaches the same listener by bubbling. */
    const tapAt = (from, to = from) => {
      const mk = (type, p) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: p.x, clientY: p.y });
      const c = $('canvasHost');
      c.dispatchEvent(mk('pointerdown', from));
      c.dispatchEvent(mk('pointerup', to));
    };
    const lineObjects = () => Scene.groups().buildings.children.filter((o) => o.userData.kind === 'removed');
    const cardText = () => ($('selCard').hidden ? '' : $('selCard').textContent);
    /** Runs fn in a closed project with the synthetic site in the scene and an empty removed list; puts it all back. */
    const withRemove = (fn) => inProject(async (mem, urls) => {
      Scene.setModel(model);
      Object.assign(App.state, { removed: new Set(), removedKey: null, selected: null });
      App.renderCard(); App.renderMetrics();
      try { return await fn(mem, urls); } finally {
        Object.assign(App.state, { removed: new Set(), removedKey: null, selected: null });
        Scene.setModel(model);
        App.renderCard(); App.renderMetrics();
      }
    });
    const runFnFor = (lat = LAT) => async () => ({ ...fakeResult(), loc: { lat, lon: LON, label: 'Test Address' }, failed: [], timings: {} });

    await t('remove: Scene.pick at the roof of b-data returns b-data; at empty ground it returns null', () => withRemove(() => {
      const hit = Scene.pick(ptOf('b-data').x, ptOf('b-data').y), e = groundPt(900, 500), none = Scene.pick(e.x, e.y);
      const hit2 = Scene.pick(ptOf('b-court').x - 1, ptOf('b-court').y);
      return eq([hit && hit.id, hit && hit.building.rule, hit && hit.removed, none, hit2 && hit2.id], ['b-data', 'data', false, null, 'b-court']);
    }));
    await t('remove: the estimate mesh is picked too (b-est)', () => withRemove(() => {
      const p = ptOf('b-est'), hit = Scene.pick(p.x, p.y);
      return eq(hit && hit.id, 'b-est');
    }));
    await t('remove: a tap on a building opens the card (Building, 98.4 ft, rule, id, Remove); a 20 px drag does not', () => withRemove(() => {
      const p = ptOf('b-data');
      tapAt({ x: p.x, y: p.y }, { x: p.x + 20, y: p.y });
      const afterDrag = $('selCard').hidden;
      tapAt(p);
      const txt = cardText();
      return eq([afterDrag, txt.includes('Building'), txt.includes('98.4 ft'), txt.includes('height from the data'), txt.includes('b-data'), $('selAction').textContent, Scene.selection(), Scene.groups().site.children.some((g) => g.children && g.children.length > 0)],
        [true, true, true, true, true, 'Remove', 'b-data', true]);
    }));
    await t('remove: Escape and a tap on empty ground close the card', () => withRemove(() => {
      const p = ptOf('b-data'), e = groundPt(900, 500);
      tapAt(p);
      const open = !$('selCard').hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const afterEsc = [$('selCard').hidden, Scene.selection()];
      tapAt(p); tapAt(e);
      return eq([open, afterEsc, $('selCard').hidden, Scene.selection()], [true, [true, null], true, null]);
    }));
    await t('remove: Remove flags b-data (buildings 3, removed 1, one dashed outline, panel line) and the card says Restore', () => withRemove(() => {
      tapAt(ptOf('b-data'));
      $('selAction').click();
      const i = Scene.info(), line = lineObjects()[0];
      return eq([i.buildings, i.removed, lineObjects().length, line && line.material.isLineDashedMaterial, line && !!line.geometry.getAttribute('lineDistance'), $('removedText') && $('removedText').textContent, $('selAction').textContent, App.state.selected.id, [...App.state.removed]],
        [3, 1, 1, true, true, 'Removed buildings: 1', 'Restore', 'b-data', ['b-data']]);
    }));
    await t('remove: a removed building cannot be hit as a solid; the roof point is empty and no solid mesh holds it', () => withRemove(() => {
      App.removeBuilding('b-data');
      const p = ptOf('b-data'), hit = Scene.pick(p.x, p.y);
      return eq([hit === null || hit.removed === true || hit.id !== 'b-data', Scene.info().buildingMeshes], [true, 2]);
    }));
    await t('remove: a tap on the dashed footprint selects the removed building and the card opens with Restore', () => withRemove(() => {
      App.removeBuilding('b-data');
      App.selectHit(null);
      const g = ptOf('b-data', false), hit = Scene.pick(g.x, g.y);
      tapAt(g);
      return eq([hit && hit.id, hit && hit.removed, $('selCard').hidden, $('selAction') && $('selAction').textContent, cardText().includes('Removed')], ['b-data', true, false, 'Restore', true]);
    }));
    await t('remove: Restore brings the solid back and hides the panel line', () => withRemove(() => {
      tapAt(ptOf('b-data')); $('selAction').click();
      $('selAction').click();
      const i = Scene.info();
      return eq([i.buildings, i.removed, lineObjects().length, !!$('removedLine'), $('selAction').textContent, Scene.pick(ptOf('b-data').x, ptOf('b-data').y).id], [4, 0, 0, false, 'Remove', 'b-data']);
    }));
    await t('remove: two buildings, then Restore all clears both', () => withRemove(() => {
      App.removeBuilding('b-data'); App.removeBuilding('b-court');
      const two = [Scene.info().buildings, Scene.info().removed, $('removedText').textContent, Scene.removedIds()];
      $('restoreAll').click();
      return eq([two, Scene.info().buildings, Scene.info().removed, !!$('removedLine'), [...App.state.removed]], [[2, 2, 'Removed buildings: 2', ['b-court', 'b-data']], 4, 0, false, []]);
    }));
    await t('remove: setRemoved rebuilds only the buildings (camera and ground stay, still 2 meshes, courtyard outline has the hole)', () => withRemove(() => {
      const cam = Scene.camera(), before = cam.position.toArray(), ground = Scene.groups().ground.children[0];
      App.removeBuilding('b-court');
      const line = lineObjects()[0], n = line.geometry.getAttribute('position').count / 2;
      const r = [cam.position.toArray().join() === before.join(), Scene.groups().ground.children[0] === ground, Scene.info().buildingMeshes, n > 20];
      return eq(r, [true, true, 2, true]);
    }));
    await t('remove: the outline hides when the Buildings layer is off, and nothing is picked then', () => withRemove(() => {
      App.removeBuilding('b-data');
      Scene.setLayer('buildings', false);
      const p = ptOf('b-court'), g = ptOf('b-data', false), r = [Scene.groups().buildings.visible, Scene.pick(p.x, p.y), Scene.pick(g.x, g.y)];
      Scene.setLayer('buildings', true);
      return eq(r, [false, null, null]);
    }));
    await t('remove: Remove on the card writes the removed list to meta, the DXF and the notes', () => withRemove(() => {
      App.removeBuilding('b-data');
      const m = App.metaOf(), dxf = App.fileFor('dxf').text, md = App.fileFor('notes').text, poly = (layer) => (dxf.match(new RegExp(`POLYLINE\\n\\s*8\\n${layer}\\n`, 'g')) || []).length;
      return eq([m.removed, poly('BLDG-DATA'), poly('BLDG-REMOVED'), md.includes('Removed buildings: 1')], [['b-data'], 2, 1, true]);
    }));
    await t('remove: no removal, no BLDG-REMOVED layer content in the DXF', () => withRemove(() => {
      const dxf = App.fileFor('dxf').text;
      return eq([(dxf.match(/POLYLINE\n\s*8\nBLDG-REMOVED\n/g) || []).length, (dxf.match(/POLYLINE\n\s*8\nBLDG-DATA\n/g) || []).length], [0, 3]);
    }));
    await t('remove: with a project open, Remove writes site.state.removed and derived.buildings[].removed after the save delay', () => withRemove(async (mem) => {
      const doc = App.projectCreate('Remove test', { quiet: true });
      tapAt(ptOf('b-data'));
      $('selAction').click();
      const at0 = ProjectMod.getSection(ProjectMod.loadProject(mem, doc.id), 'site').state.removed;
      await new Promise((r) => setTimeout(r, CONFIG.projectSaveMs + 300));
      const sec = ProjectMod.getSection(ProjectMod.loadProject(mem, doc.id), 'site');
      const flags = Object.fromEntries(sec.derived.buildings.map((b) => [b.id, 'removed' in b ? b.removed : 'none']));
      return eq([at0, sec.state.removed, sec.derived.buildings.length, flags], [[], ['b-data'], 4, { 'b-data': true, 'b-floors': 'none', 'b-court': 'none', 'b-est': 'none' }]);
    }));
    await t('remove: Restore all writes an empty list and no removed keys', () => withRemove(async (mem) => {
      const doc = App.projectCreate('Remove test 2', { quiet: true });
      App.removeBuilding('b-data'); App.removeBuilding('b-est');
      App.restoreAll();
      App.flushProject();
      const sec = ProjectMod.getSection(ProjectMod.loadProject(mem, doc.id), 'site');
      return eq([sec.state.removed, sec.derived.buildings.some((b) => 'removed' in b)], [[], false]);
    }));
    await t('remove: Send to the Tower carries the removed list in the project', () => withRemove(async (mem, urls) => {
      App.state.typed = 'Test Address';
      App.removeBuilding('b-court');
      await App.projectSend('tower');
      const sec = ProjectMod.getSection(ProjectMod.loadProject(mem, App.project.doc.id), 'site');
      return eq([urls.length, sec.state.removed, sec.derived.buildings.filter((b) => b.removed).map((b) => b.id)], [1, ['b-court'], ['b-court']]);
    }));
    await t('remove: reopening a project restores state.removed and the outline; an id that no longer exists is dropped', () => withRemove(async () => {
      const doc = siteProjectDoc({ removed: ['b-data', 'gone-id'] });
      App.openProjectDoc(doc);
      const req = App.siteRequest(doc);
      const before = [...App.state.removed].sort();
      await App.go({ ...req, runFn: runFnFor() });
      App.flushProject();
      const i = Scene.info();
      return eq([before, [...App.state.removed], i.buildings, i.removed, lineObjects().length, $('removedText').textContent, ProjectMod.getSection(App.project.doc, 'site').state.removed], [['b-data', 'gone-id'], ['b-data'], 3, 1, 1, 'Removed buildings: 1', ['b-data']]);
    }));
    await t('remove: loading the same address again keeps the removed list', () => withRemove(async () => {
      await App.go({ text: 'Test Address', size: SIZE, runFn: runFnFor() });
      App.removeBuilding('b-data');
      await App.go({ text: 'Test Address', size: SIZE, runFn: runFnFor() });
      return eq([[...App.state.removed], Scene.info().removed], [['b-data'], 1]);
    }));
    await t('remove: a new address clears the removed list', () => withRemove(async () => {
      await App.go({ text: 'Test Address', size: SIZE, runFn: runFnFor() });
      App.removeBuilding('b-data');
      await App.go({ text: 'Other Address', size: SIZE, runFn: runFnFor(LAT + 0.01) });
      return eq([[...App.state.removed], Scene.info().buildings, Scene.info().removed, !!$('removedLine')], [[], 4, 0, false]);
    }));
    await t('remove: a piece id (x~2) removes every piece of the feature', () => withRemove(() => {
      App.removeBuilding('b-data~2');
      return eq([[...App.state.removed], Scene.info().removed], [['b-data'], 1]);
    }));
    await t('remove: the help block has the Remove buildings paragraph', () => eq([!!$('helpSec'), $('helpRemove').textContent.startsWith('Click a building in the 3D view'), $('helpRemove').textContent.includes('BLDG-REMOVED')], [true, true, true]));
    await t('remove: the scene renders with outlines and a selection without a GL error', () => withRemove(() => {
      App.removeBuilding('b-data');
      App.selectHit({ id: 'b-court', building: bById('b-court') });
      Scene.renderNow();
      const gl = canvasEl().getContext('webgl2');
      return !gl || gl.getError() === 0 || `gl error ${gl.getError()}`;
    }));

    /* ---- collapsible blocks (docs/site-base-style-technical-plan.md section 4.3): Location open, the rest folded, the choice remembered ---- */
    const blockState = () => Object.fromEntries([...document.querySelectorAll('#sections [data-block]')].map((b) => [b.dataset.block, b.querySelector(':scope > .sec-head').getAttribute('aria-expanded') === 'true' && !b.querySelector(':scope > .sec-body').hidden]));
    const withBlocks = async (fn) => {
      const saved = Local.get(App.BLOCKS_KEY, null);
      try { localStorage.removeItem(App.BLOCKS_KEY); } catch (e) { /* no storage */ }
      App.rebuildBlocks();
      try { return await fn(); } finally {
        try { if (saved == null) localStorage.removeItem(App.BLOCKS_KEY); else Local.set(App.BLOCKS_KEY, saved); } catch (e) { /* no storage */ }
        App.rebuildBlocks();
      }
    };
    await t('blocks: on a fresh profile only Location is open (Layers, View, Site data and Remove buildings are folded)', () => withBlocks(() =>
      eq(blockState(), { location: true, layers: false, view: false, data: false, help: false })));
    await t('blocks: the address field and the Go button show while the other blocks are folded', () => withBlocks(() => {
      const vis = (el) => !!el && el.getClientRects().length > 0;
      return eq([vis($('addr')), vis($('goBtn')), vis(document.querySelector('[data-layer]')), vis($('metrics'))], [true, true, false, false]);
    }));
    await t('blocks: a block opens on its header button, stays open after a rebuild from the saved choice, and Location folds the same way', () => withBlocks(() => {
      $('blockHead-layers').click();
      $('blockHead-location').click();
      const saved = App.blockPrefs();
      App.rebuildBlocks();
      return eq([saved, blockState()], [{ layers: true, location: false }, { location: false, layers: true, view: false, data: false, help: false }]);
    }));
    await t('blocks: the saved choice sits in localStorage under cmrlm.site.sections', () => withBlocks(() => {
      $('blockHead-view').click();
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem('cmrlm.site.sections')); } catch (e) { raw = null; }
      return eq([App.BLOCKS_KEY, raw && raw.view], ['cmrlm.site.sections', true]);
    }));

    /* ---- Collapse all and the Site zoom button (docs/batch-fixes-technical-plan.md sections 4 and 5; the Building button does not apply here and stays hidden) ---- */
    const raf = (n = 3) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const ALL_FOLDED = { location: false, layers: false, view: false, data: false, help: false };
    await t('collapse all: the button sits at the top of the panel with a name and a touch-size target', () => {
      const b = $('panelCollapse');
      if (!b) return 'missing #panelCollapse';
      const r = b.getBoundingClientRect();
      return eq([b.tagName, !!b.getAttribute('aria-label'), r.height >= 40, !!b.closest('#panel'), b.textContent.trim()], ['BUTTON', true, true, true, 'Collapse all']);
    });
    await t('collapse all: it closes every block, saves each one as closed under cmrlm.site.sections, and a rebuild keeps them closed', () => withBlocks(() => {
      $('blockHead-layers').click(); $('blockHead-view').click();
      const before = Object.values(blockState()).filter(Boolean).length;
      $('panelCollapse').click();
      const closed = blockState();
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(App.BLOCKS_KEY)); } catch (e) { raw = null; }
      App.rebuildBlocks();
      const sorted = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k]]);
      return eq([before, closed, sorted(raw), blockState()], [3, ALL_FOLDED, sorted(ALL_FOLDED), ALL_FOLDED]);
    }));
    await t('collapse all: a block opened afterwards stays open after a rebuild, the others stay closed', () => withBlocks(() => {
      $('panelCollapse').click();
      $('blockHead-data').click();
      App.rebuildBlocks();
      return eq(blockState(), { ...ALL_FOLDED, data: true });
    }));
    await t('zoom: the bottom bar has a Site button with a name and a touch-size target; the Building button is hidden here', () => {
      const s = $('tbZoomSite'), b = $('tbZoomBuilding');
      if (!s || !b) return 'missing zoom buttons';
      const r = s.getBoundingClientRect();
      return eq([!!s.closest('#viewBar'), !!s.closest('#topbar'), !!s.getAttribute('aria-label'), r.height >= 40, s.textContent.trim(), b.hidden, b.getClientRects().length, TopBar.info().building], [true, false, true, true, 'Site', true, 0, false]);
    });
    await t('B1. the bottom bar holds the view buttons, Site, Building, Model / Diagram; none of them is in the top bar', () => {
      const want = ['views', 'tbZoomSite', 'tbZoomBuilding']; const i = TopBar.barInfo(want);
      const bar = document.getElementById('viewBar'), vp = document.getElementById('viewport');
      if (!bar || !vp) return 'no bottom bar';
      const r = bar.getBoundingClientRect(), v = vp.getBoundingClientRect();
      const inside = r.left >= v.left - 1 && r.right <= v.right + 1 && r.bottom <= v.bottom + 1 && r.top >= v.top;
      const metrics = document.getElementById('tbMetrics');
      const pressed = !metrics || metrics.getAttribute('aria-pressed') === String(!TopBar.hudHidden());
      return eq([i.missing, i.inTop, want.filter((id) => !i.inBar.includes(id)), i.views >= 2, inside, pressed], [[], [], [], true, true, true]);
    });
    await t('zoom: the Site button calls Scene.frameSite', () => {
      const orig = Scene.frameSite;
      let n = 0;
      Scene.frameSite = () => { n += 1; return orig(false); };
      try { $('tbZoomSite').click(); } finally { Scene.frameSite = orig; }
      return eq(n, 1);
    });
    await t('zoom: Site fits the whole site square in the view, keeps the camera direction, and leaves no view button pressed', () => withRemove(async () => {
      if (!Scene.ready()) return true;
      Scene.planView(false);
      Scene.camera().position.add(new THREE.Vector3(120, 40, -90));       // a view the presets do not make
      await raf(3);
      const cam = Scene.camera(), dir = () => { cam.updateMatrixWorld(true); return cam.getWorldDirection(new THREE.Vector3()); };
      const d0 = dir();
      Scene.frameSite(false);
      const d1 = dir();
      cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of Scene.framedCorners()) { const p = c.clone().project(cam); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const fill = Math.max(x1 - x0, y1 - y0);
      const pressed = [$('btnFit'), $('btnPlan')].filter((b) => b.getAttribute('aria-pressed') === 'true').length;
      return eq([d0.distanceTo(d1) < 0.001, x0 >= -1.02 && x1 <= 1.02 && y0 >= -1.02 && y1 <= 1.02, fill > 0.5, pressed, Scene.info().preset], [true, true, true, 0, null]);
    }));
    await t('zoom: Fit still turns the view to the three-quarter view after Site', () => withRemove(async () => {
      if (!Scene.ready()) return true;
      Scene.frameSite(false);
      Scene.fit(false);
      await raf(2);
      return eq([Scene.info().preset, $('btnFit').getAttribute('aria-pressed')], ['fit', 'true']);
    }));

    return results;
  }

  function show(results) {
    const failed = results.filter((r) => !r.ok);
    const panel = $('testPanel');
    panel.hidden = false;
    panel.textContent = '';
    panel.append(h('h2', { class: failed.length ? 'fail' : 'pass', id: 'testSummary' }, failed.length ? `Tests: ${failed.length} of ${results.length} failed` : `Tests: all ${results.length} passed`), h('div', { class: 'det' }, 'Tap here to close this list.'));
    for (const r of results) panel.append(h('div', { class: 'row' }, h('span', { class: r.ok ? 'ok' : 'no' }, r.ok ? 'pass' : 'FAIL'), h('span', null, r.name, r.ok ? null : h('span', { class: 'det' }, r.detail))));
    panel.addEventListener('click', () => { panel.hidden = true; });
  }

  return { run, show, synthetic, encodeTiff };
})();
