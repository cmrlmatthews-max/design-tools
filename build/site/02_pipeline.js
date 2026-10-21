/* ==========================================================================
   PIPELINE
   Address -> frame -> (ground DEM | Overture release -> three PMTiles themes) -> model.
   Network functions take a fetch function so the in-page tests can inject fakes.
   A failure in one Overture theme marks that step and the rest still renders.
   A ground failure stops the run with a clear message.
   ========================================================================== */
const Pipeline = (() => {
  const { geocode, parseCoordinates } = GeocodeMod;
  const { makeFrame, tilesForBBox } = GeoMod;
  const { demRequestUrl, readFloatTiff } = TiffMod;
  const { latestOvertureRelease, openPMTiles, OVERTURE_BUCKET } = PMTilesMod;
  const { decodeTile } = MvtMod;
  const { buildModel, buildRoads, featuresFromTiles, summarize } = ModelMod;

  const errText = (e) => (e && e.message ? e.message : String(e));
  const netText = (e, what) => (e instanceof TypeError ? `Could not reach the ${what}. Check the connection and try again.` : errText(e));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** DEM for the site box plus margin; about 1 pixel per 3 ft, at most 1024 per side. */
  async function fetchDem(frame, fetchFn) {
    const px = clamp(Math.ceil((frame.size + 2 * CONFIG.demMargin) / CONFIG.demFtPerPixel), 32, CONFIG.demMaxPixels);
    const url = demRequestUrl(frame.bbox(CONFIG.demMargin), px, px);
    let res;
    try { res = await fetchFn(url); } catch (e) { throw new Error(netText(e, 'USGS elevation service')); }
    if (!res.ok) throw new Error(`The USGS elevation service answered HTTP ${res.status}.`);
    const buf = await res.arrayBuffer();
    try { return readFloatTiff(buf); } catch (e) { throw new Error(`The elevation data could not be read (${errText(e)}).`); }
  }

  /** Every tile of one Overture theme that touches the site square, decoded. */
  async function fetchTheme(release, theme, frame, fetchFn) {
    const pm = openPMTiles(`${OVERTURE_BUCKET}/tiles/${release}/${theme}.pmtiles`, { fetchFn });
    let header;
    try { header = await pm.header(); } catch (e) { throw new Error(netText(e, 'Overture map data')); }
    const z = Math.min(header.maxZoom, CONFIG.zoomCap[theme]);
    const list = tilesForBBox(frame.bbox(0), z);
    const out = [];
    await Promise.all(list.map(async (t) => {
      let bytes;
      try { bytes = await pm.getTile(t.z, t.x, t.y); } catch (e) { throw new Error(netText(e, 'Overture map data')); }
      if (bytes) out.push({ z: t.z, x: t.x, y: t.y, layers: decodeTile(bytes) });
    }));
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
  }

  const THEMES = [['buildings', 'buildings'], ['roads', 'transportation'], ['base', 'base']];   // [step, theme]

  /**
   * @param {{text:string, size:number, loc?:{lat:number,lon:number,label:string}}} req
   *   `loc` skips the address lookup (used by the recent-sites list).
   * @param {(step:string, status:'pending'|'working'|'done'|'error', message?:string)=>void} report
   * @param {{fetchFn?:Function, walks?:boolean}} [opts]
   * @returns {Promise<{loc, frame, dem, tiles, release, model, timings}>}
   */
  async function run(req, report, { fetchFn = (u, o) => fetch(u, o), walks = false } = {}) {
    const t0 = now(), timings = {};
    const mark = (k) => { timings[k] = Math.round(now() - t0); };
    for (const [k] of CONFIG.steps) report(k, 'pending');

    // 1. address
    report('address', 'working', req.loc ? 'Saved site' : 'Looking up the address');
    let loc;
    try { loc = req.loc || await geocode(req.text, { fetchFn }); } catch (e) {
      const msg = e instanceof TypeError ? 'Could not reach the address service. Check the connection.' : errText(e);
      report('address', 'error', msg);
      throw new Error(msg);
    }
    mark('address');
    report('address', 'done', `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`);
    const frame = makeFrame(loc.lat, loc.lon, req.size);

    // 2. in parallel: ground, release then three themes
    report('ground', 'working', 'Loading elevation');
    const demP = fetchDem(frame, fetchFn).then((dem) => { mark('dem'); return { ok: true, dem }; }, (e) => ({ ok: false, error: errText(e) }));

    report('release', 'working', 'Finding the newest release');
    const relP = latestOvertureRelease({ fetchFn }).then((r) => { mark('release'); report('release', 'done', r); return r; });

    const themeP = THEMES.map(([step, theme]) => {
      report(step, 'working', 'Waiting for the release');
      return relP.then(async (release) => {
        report(step, 'working', 'Loading map tiles');
        const tiles = await fetchTheme(release, theme, frame, fetchFn);
        mark(theme);
        report(step, 'working', `${tiles.length} ${tiles.length === 1 ? 'tile' : 'tiles'} loaded`);
        return { ok: true, tiles };
      }).catch((e) => { report(step, 'error', errText(e)); return { ok: false, tiles: [], error: errText(e) }; });
    });

    const [demR, release, ...themeR] = await Promise.all([demP, relP, ...themeP]);
    if (!demR.ok) {
      report('ground', 'error', demR.error);
      THEMES.forEach(([step], i) => report(step, themeR[i].ok ? 'pending' : 'error', themeR[i].ok ? 'Not built, no ground data' : themeR[i].error));
      throw new Error(`Ground elevation could not be loaded. ${demR.error}`);
    }
    const tiles = themeR.flatMap((r) => r.tiles);

    // 3. model
    THEMES.forEach(([step], i) => { if (themeR[i].ok) report(step, 'working', 'Building the model'); });
    report('ground', 'working', 'Building the ground');
    await new Promise((r) => setTimeout(r, 0));          // let the progress list paint before the model blocks the thread
    const tm = now();
    let model;
    try { model = buildModel(frame, { dem: demR.dem, tiles, walks }); } catch (e) {
      report('ground', 'error', errText(e));
      throw new Error(`Ground elevation could not be used. ${errText(e)}`);
    }
    timings.model = Math.round(now() - tm);
    mark('total');

    const g = model.ground, s = summarize(model), E = model.errors || {};
    report('ground', 'done', `${g.n} by ${g.n} points, ${grouped(s.groundMin, 1)} to ${grouped(s.groundMax, 1)} ft`);
    const fin = (step, ok, err, msg) => {
      if (!ok) return;                                 // already marked as an error
      if (err) report(step, 'error', err); else report(step, 'done', msg);
    };
    fin('buildings', themeR[0].ok, E.features || E.buildings, `${s.buildings} buildings${s.estimated ? `, ${s.estimated} with an estimated height` : ''}`);
    fin('roads', themeR[1].ok, E.features || E.roads, `${model.roads.segments.length} road segments, ${grouped(s.roadsFt)} ft`);
    fin('base', themeR[2].ok, E.features || E.trees || E.water, `${s.trees} trees, ${s.waterAreas} water ${s.waterAreas === 1 ? 'area' : 'areas'}`);

    return { loc, frame, dem: demR.dem, tiles, release, model, timings, failed: THEMES.filter((t, i) => !themeR[i].ok).map((t) => t[0]) };
  }

  /** Rebuild roads with walks from the cached tiles (no refetch). Returns the new roads object. */
  function buildWalks(result) {
    const features = result.features || (result.features = featuresFromTiles(result.tiles, result.frame));
    return buildRoads(features, result.frame, result.model.ground, { walks: true });
  }

  return { run, buildWalks, fetchDem, fetchTheme, parseCoordinates };
})();
