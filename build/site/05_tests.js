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
