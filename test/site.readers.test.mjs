// Run: node test/site.readers.test.mjs
// Tests for src/site/{geo,geocode,pmtiles,mvt,tiff}.js.
// Fixture tests read real data from $SITE_FIXTURES (default /home/claude/sqwork/fixtures) and skip when it is missing.
// Cross-checks against @mapbox/vector-tile and geotiff run only when /home/claude/sqwork/node_modules exists.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const geo = await import("../src/site/geo.js");
const gc = await import("../src/site/geocode.js");
const pm = await import("../src/site/pmtiles.js");
const mvt = await import("../src/site/mvt.js");
const tiff = await import("../src/site/tiff.js");

let pass = 0, fail = 0, skip = 0;
async function t(name, fn) {
  try { const r = await fn(); if (r === "skip") { skip++; console.log("  skip " + name); } else { pass++; console.log("  ok   " + name); } }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const rejects = async (p, re) => { try { await p; } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("expected a rejection"); };
const throws = (fn, re) => { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("expected a throw"); };

const FIX = process.env.SITE_FIXTURES || "/home/claude/sqwork/fixtures";
const haveFix = fs.existsSync(FIX);
const fx = name => new Uint8Array(fs.readFileSync(path.join(FIX, name)));
const SQ = "/home/claude/sqwork/node_modules";
const haveRef = fs.existsSync(SQ + "/@mapbox/vector-tile");
const haveGeotiff = fs.existsSync(SQ + "/geotiff");
if (!haveFix) console.log(`  (fixtures not found at ${FIX}: fixture tests will be skipped)`);

console.log("site.readers.test.mjs");

// ---------------------------------------------------------------- geo
console.log(" geo");
const frame = geo.makeFrame(27.9522013, -82.50182, 1000);

await t("makeFrame: center maps to (half, half) and back", () => {
  const [x, y] = frame.toLocal(-82.50182, 27.9522013);
  near(x, 500, 1e-9); near(y, 500, 1e-9);
  const [lon, lat] = frame.toLonLat(123.4, 876.5);
  const [x2, y2] = frame.toLocal(lon, lat);
  near(x2, 123.4, 1e-6); near(y2, 876.5, 1e-6);
});
await t("makeFrame: meters per degree at 27.95N match the spec formulas", () => {
  near(frame.mPerDegLat, 110818.7, 0.5);
  near(frame.mPerDegLon, 98405.3, 0.5);
  eq(frame.size, 1000); eq(frame.half, 500);
});
await t("makeFrame: bbox spans the site square (+ margin) in feet", () => {
  const b = frame.bbox(0), bm = frame.bbox(50);
  near((b.north - b.south) * frame.mPerDegLat / geo.FT, 1000, 1e-6);
  near((b.east - b.west) * frame.mPerDegLon / geo.FT, 1000, 1e-6);
  near((bm.north - bm.south) * frame.mPerDegLat / geo.FT, 1100, 1e-6);
  const [x, y] = frame.toLocal(b.west, b.south);
  near(x, 0, 1e-6); near(y, 0, 1e-6);
  const [x2, y2] = frame.toLocal(b.east, b.north);
  near(x2, 1000, 1e-6); near(y2, 1000, 1e-6);
});
await t("makeFrame: north is +y, east is +x", () => {
  const [x, y] = frame.toLocal(-82.50182 + 0.001, 27.9522013 + 0.001);
  ok(x > 500 && y > 500);
});
await t("gridSpacing: spec examples and the 10,000 point limit", () => {
  const g = geo.gridSpacing(1000); eq(g.spacing, 10.5); eq(g.n, 96);
  eq(geo.gridSpacing(500).spacing, 10); eq(geo.gridSpacing(500).n, 51);
  for (const s of [500, 1000, 1500, 2000, 3000]) { const q = geo.gridSpacing(s); ok(q.n * q.n <= 10000, "n^2 for " + s); ok(q.spacing >= 10); }
  eq(geo.gridSpacing(3000).spacing, 30.5);
});
await t("tileForLonLat: the Tampa site center is in z14 tile 4437/6866", () => {
  const tl = geo.tileForLonLat(-82.50182, 27.9522013, 14);
  eq(tl.x, 4437); eq(tl.y, 6866);
  const t0 = geo.tileForLonLat(0.0001, -0.0001, 0); eq(t0.x, 0); eq(t0.y, 0);
  const t1 = geo.tileForLonLat(10, 10, 1); eq(t1.x, 1); eq(t1.y, 0);
});
await t("tilesForBBox: covers the box, row-major, one tile for a small box", () => {
  eq(JSON.stringify(geo.tilesForBBox(frame.bbox(50), 14)), JSON.stringify([{ z: 14, x: 4437, y: 6866 }]));
  // the fixture DEM box crosses the tile boundary at lat 27.9556 -> two tiles, north one first
  const tl = geo.tilesForBBox({ west: -82.5062799, south: 27.94766715, east: -82.4972604, north: 27.95668665 }, 14);
  eq(JSON.stringify(tl), JSON.stringify([{ z: 14, x: 4437, y: 6865 }, { z: 14, x: 4437, y: 6866 }]));
  eq(geo.tilesForBBox({ west: -1, south: -1, east: 1, north: 1 }, 1).length, 4);
});
await t("tileToLonLat: corners and center", () => {
  const nw = geo.tileToLonLat(0, 0, 0, 0, 0, 4096);
  near(nw[0], -180); near(nw[1], 85.0511287798, 1e-8);
  const c = geo.tileToLonLat(0, 0, 0, 2048, 2048, 4096);
  near(c[0], 0, 1e-9); near(c[1], 0, 1e-9);
  const a = geo.tileToLonLat(14, 4437, 6866, 0, 0, 4096), b = geo.tileToLonLat(14, 4437, 6866, 4096, 4096, 4096);
  near(b[0], geo.tileToLonLat(14, 4438, 6866, 0, 0, 4096)[0], 1e-9);
  near(b[1], geo.tileToLonLat(14, 4437, 6867, 0, 0, 4096)[1], 1e-9);
  ok(a[0] < b[0] && a[1] > b[1]);
  ok(a[0] < -82.50182 && b[0] > -82.50182 && a[1] > 27.9522 && b[1] < 27.9522);
});

// ---------------------------------------------------------------- geocode
console.log(" geocode");
const GM = "https://www.google.com/maps/place/3615+W+Cypress+St,+Tampa,+FL+33607/@27.9522013,-82.50182,17z/data=!3m1!4b1!4m6!3m5!1s0x88c2c3!8m2!3d27.9522013!4d-82.50182";
await t("parseCoordinates: plain text forms", () => {
  let p = gc.parseCoordinates("27.9522, -82.5018"); eq(p.lat, 27.9522); eq(p.lon, -82.5018);
  p = gc.parseCoordinates("  27.9522,-82.5018 "); eq(p.lat, 27.9522);
  p = gc.parseCoordinates("27.9522 -82.5018"); eq(p.lon, -82.5018);
  p = gc.parseCoordinates("(27.95, -82.50)"); eq(p.lat, 27.95);
});
await t("parseCoordinates: Google Maps place URL", () => {
  const p = gc.parseCoordinates(GM); eq(p.lat, 27.9522013); eq(p.lon, -82.50182);
});
await t("parseCoordinates: !3d/!4d place coords win over @ camera coords", () => {
  const u = "https://www.google.com/maps/place/X/@27.9,-82.4,17z/data=!3d27.9522013!4d-82.50182";
  const p = gc.parseCoordinates(u); eq(p.lat, 27.9522013); eq(p.lon, -82.50182);
});
await t("parseCoordinates: @lat,lon only, ?q=, ll=", () => {
  let p = gc.parseCoordinates("https://www.google.com/maps/@27.9522013,-82.50182,17z"); eq(p.lat, 27.9522013); eq(p.lon, -82.50182);
  p = gc.parseCoordinates("https://www.google.com/maps?q=27.95,-82.50"); eq(p.lat, 27.95); eq(p.lon, -82.5);
  p = gc.parseCoordinates("https://maps.google.com/?ll=27.95,-82.50&z=18"); eq(p.lat, 27.95);
  p = gc.parseCoordinates("https://www.google.com/maps/search/?api=1&query=27.95%2C-82.50"); eq(p.lon, -82.5);
});
await t("parseCoordinates: rejects non-US points and non-coordinates", () => {
  eq(gc.parseCoordinates("48.85, 2.35"), null);          // Paris: lon > -60
  eq(gc.parseCoordinates("10, -82"), null);              // lat < 18
  eq(gc.parseCoordinates("80, -82"), null);              // lat > 72
  eq(gc.parseCoordinates("3615 W Cypress St, Tampa, FL"), null);
  eq(gc.parseCoordinates(""), null);
  eq(gc.parseCoordinates(null), null);
  eq(gc.parseCoordinates("https://maps.app.goo.gl/abc123"), null);
  const ak = gc.parseCoordinates("64.8, -147.7"); eq(ak.lat, 64.8);   // Alaska is inside the box
});
const nomFixture = haveFix ? fs.readFileSync(path.join(FIX, "nominatim_tampa.json"), "utf8") : JSON.stringify([{ lat: "27.9522013", lon: "-82.5018200", display_name: "3615, West Cypress Street, Tampa" }]);
await t("geocode: coordinates skip the network", async () => {
  let calls = 0;
  const r = await gc.geocode("27.9522, -82.5018", { fetchFn: async () => { calls++; } });
  eq(calls, 0); eq(r.lat, 27.9522); eq(r.lon, -82.5018);
});
await t("geocode: Nominatim request URL and result (string lat/lon parsed)", async () => {
  let url = "";
  const fetchFn = async u => { url = u; return { ok: true, status: 200, json: async () => JSON.parse(nomFixture) }; };
  const r = await gc.geocode("3615 W Cypress St, Tampa FL", { fetchFn });
  eq(url, "https://nominatim.openstreetmap.org/search?q=3615%20W%20Cypress%20St%2C%20Tampa%20FL&format=jsonv2&limit=1&countrycodes=us");
  eq(typeof r.lat, "number"); near(r.lat, 27.9522013); near(r.lon, -82.50182);
  ok(r.label.startsWith("3615, West Cypress Street"), r.label);
});
await t("geocode: empty result and HTTP errors throw", async () => {
  await rejects(gc.geocode("zzzz nowhere", { fetchFn: async () => ({ ok: true, json: async () => [] }) }), /Address not found/);
  await rejects(gc.geocode("   ", { fetchFn: async () => { throw new Error("should not call"); } }), /Address not found/);
  await rejects(gc.geocode("x street", { fetchFn: async () => ({ ok: false, status: 429, json: async () => [] }) }), /429/);
});
await t("googleMapsUrl: exact format", () => {
  eq(gc.googleMapsUrl(27.9522, -82.5018), "https://www.google.com/maps/@?api=1&map_action=map&center=27.9522,-82.5018&zoom=18&basemap=satellite");
});

// ---------------------------------------------------------------- pmtiles
console.log(" pmtiles");
await t("zxyToTileId: reference values", () => {
  eq(pm.zxyToTileId(0, 0, 0), 0);
  eq(pm.zxyToTileId(1, 0, 0), 1); eq(pm.zxyToTileId(1, 0, 1), 2); eq(pm.zxyToTileId(1, 1, 1), 3); eq(pm.zxyToTileId(1, 1, 0), 4);
  // values from the verified Python reference
  eq(pm.zxyToTileId(14, 4437, 6865), 138616301); eq(pm.zxyToTileId(14, 4437, 6866), 138616306);
  eq(pm.zxyToTileId(13, 2218, 3432), 34654075); eq(pm.zxyToTileId(13, 2218, 3433), 34654076);
  eq(pm.zxyToTileId(5, 17, 12), 1200); eq(pm.zxyToTileId(10, 300, 700), 833781);
  eq(pm.zxyToTileId(15, 32767, 0), 1431655764); eq(pm.zxyToTileId(15, 12345, 23456), 840605334);
  eq(pm.zxyToTileId(3, 7, 2), 70);
  throws(() => pm.zxyToTileId(1, 2, 0), /out of range/);
});
await t("zxyToTileId: every z3 tile gets a distinct id in [21, 84]", () => {
  const seen = new Set();
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(pm.zxyToTileId(3, x, y));
  eq(seen.size, 64); ok(Math.min(...seen) === 21 && Math.max(...seen) === 84);
});

await t("latestOvertureRelease: picks the last sorted prefix", async () => {
  let url = "";
  const xml = `<?xml version="1.0"?><ListBucketResult><Prefix>tiles/</Prefix><CommonPrefixes><Prefix>tiles/2026-09-23.1/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-08-20.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-10-14.0/</Prefix></CommonPrefixes></ListBucketResult>`;
  const r = await pm.latestOvertureRelease({ fetchFn: async u => { url = u; return { ok: true, text: async () => xml }; } });
  eq(r, "2026-10-14.0");
  eq(url, pm.OVERTURE_BUCKET + "/?list-type=2&prefix=tiles/&delimiter=/");
});
await t("latestOvertureRelease: any failure falls back", async () => {
  eq(await pm.latestOvertureRelease({ fetchFn: async () => { throw new Error("net"); } }), pm.OVERTURE_FALLBACK_RELEASE);
  eq(await pm.latestOvertureRelease({ fetchFn: async () => ({ ok: false, status: 403, text: async () => "" }) }), pm.OVERTURE_FALLBACK_RELEASE);
  eq(await pm.latestOvertureRelease({ fetchFn: async () => ({ ok: true, text: async () => "<nothing/>" }) }), pm.OVERTURE_FALLBACK_RELEASE);
});

// --- synthetic archive
const gz = b => zlib.gzipSync(Buffer.from(b));
const wv = n => { const o = []; while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
function encDir(entries, comp = 2) {
  const o = [...wv(entries.length)];
  let last = 0;
  for (const e of entries) { o.push(...wv(e.id - last)); last = e.id; }
  for (const e of entries) o.push(...wv(e.run));
  for (const e of entries) o.push(...wv(e.len));
  entries.forEach((e, i) => o.push(...wv(i > 0 && e.off === entries[i - 1].off + entries[i - 1].len ? 0 : e.off + 1)));
  return comp === 2 ? gz(o) : Buffer.from(o);
}
/** Archive: z0 tile (id 0); a 3-tile run at z3; a leaf directory covering ids 85..(tidA-1) with two z4 tiles; z14 tile A. */
function buildArchive({ tileComp = 2, tileA = Buffer.from("tile-A-bytes") } = {}) {
  const pack = b => (tileComp === 2 ? gz(b) : Buffer.from(b));
  const idA = pm.zxyToTileId(14, 4437, 6865);
  const idRun = 21 + 10;
  const idL1 = pm.zxyToTileId(4, 3, 5), idL2 = pm.zxyToTileId(4, 9, 2);
  const payloads = { z0: pack("tile-z0"), run: pack("tile-run"), l1: pack("tile-L1"), l2: pack("tile-L2"), A: pack(tileA) };
  let off = 0; const place = {};
  for (const k of Object.keys(payloads)) { place[k] = { off, len: payloads[k].length }; off += payloads[k].length; }
  const tileData = Buffer.concat(Object.values(payloads));
  const leafEntries = [idL1, idL2].sort((a, b) => a - b).map(id => { const k = id === idL1 ? "l1" : "l2"; return { id, run: 1, off: place[k].off, len: place[k].len }; });
  const leaf = encDir(leafEntries);
  const root = encDir([
    { id: 0, run: 1, off: place.z0.off, len: place.z0.len },
    { id: idRun, run: 3, off: place.run.off, len: place.run.len },
    { id: 85, run: 0, off: 0, len: leaf.length },                         // leaf pointer: ids 85 .. idA-1
    { id: idA, run: 1, off: place.A.off, len: place.A.len },
  ]);
  const meta = Buffer.from("{}");
  const dataOff = 16384;
  const leafOff = dataOff + tileData.length;
  const hdr = Buffer.alloc(127);
  hdr.write("PMTiles", 0, "latin1"); hdr[7] = 3;
  const w64 = (o, v) => hdr.writeBigUInt64LE(BigInt(v), o);
  w64(8, 127); w64(16, root.length); w64(24, 127 + root.length); w64(32, meta.length);
  w64(40, leafOff); w64(48, leaf.length); w64(56, dataOff); w64(64, tileData.length);
  hdr[97] = 2; hdr[98] = tileComp; hdr[99] = 1; hdr[100] = 0; hdr[101] = 14;
  hdr.writeInt32LE(-825062799, 102); hdr.writeInt32LE(279476671, 106); hdr.writeInt32LE(-824972604, 110); hdr.writeInt32LE(279566866, 114);
  const pad = Buffer.alloc(dataOff - 127 - root.length - meta.length);
  const file = Buffer.concat([hdr, root, meta, pad, tileData, leaf]);
  return { file, ids: { idA, idRun, idL1, idL2 } };
}
function fakeFetch(file) {
  const log = [];
  const fn = async (url, opts = {}) => {
    const m = /bytes=(\d+)-(\d+)/.exec((opts.headers || {}).Range || "");
    log.push(m ? [Number(m[1]), Number(m[2])] : "full");
    const a = m ? Number(m[1]) : 0, b = m ? Math.min(Number(m[2]) + 1, file.length) : file.length;
    const copy = file.subarray(a, b);
    return { ok: true, status: m ? 206 : 200, arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.length) };
  };
  fn.log = log;
  return fn;
}
const same = (u8, str) => Buffer.from(u8).toString() === str;

await t("openPMTiles: header fields, one 16384-byte read", async () => {
  const { file } = buildArchive(); const f = fakeFetch(file);
  const p = pm.openPMTiles("x://a.pmtiles", { fetchFn: f });
  const h = await p.header(); await p.header();
  eq(h.version, 3); eq(h.maxZoom, 14); eq(h.minZoom, 0); eq(h.internalCompression, 2); eq(h.tileCompression, 2); eq(h.tileType, 1);
  eq(h.rootDirOffset, 127); eq(h.tileDataOffset, 16384);
  near(h.minLon, -82.5062799, 1e-7); near(h.maxLat, 27.9566866, 1e-7);
  eq(f.log.length, 1); eq(f.log[0][0], 0); eq(f.log[0][1], 16383);
});
await t("getTile: root hit, run-length hits, leaf directory hits (gzip tiles)", async () => {
  const { file, ids } = buildArchive(); const f = fakeFetch(file);
  const p = pm.openPMTiles("x://a.pmtiles", { fetchFn: f });
  ok(same(await p.getTile(0, 0, 0), "tile-z0"));
  ok(same(await p.getTile(14, 4437, 6865), "tile-A-bytes"));
  // run of 3 consecutive z3 ids starting at id 31: find their xy by id
  const byId = new Map();
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) byId.set(pm.zxyToTileId(3, x, y), [x, y]);
  for (let k = 0; k < 3; k++) { const [x, y] = byId.get(ids.idRun + k); ok(same(await p.getTile(3, x, y), "tile-run"), "run member " + k); }
  eq(await p.getTile(3, ...byId.get(ids.idRun + 3)), null);              // just past the run: covered by the root entry's end
  ok(same(await p.getTile(4, 3, 5), "tile-L1"));
  ok(same(await p.getTile(4, 9, 2), "tile-L2"));
});
await t("getTile: misses return null; zoom outside min..max returns null", async () => {
  const { file } = buildArchive(); const p = pm.openPMTiles("x://a.pmtiles", { fetchFn: fakeFetch(file) });
  eq(await p.getTile(1, 0, 0), null);            // id 1: after entry 0 with run 1
  eq(await p.getTile(4, 15, 15), null);          // inside leaf range, not present
  eq(await p.getTile(14, 4437, 6866), null);     // after tile A
  eq(await p.getTile(15, 0, 0), null);           // above max zoom
});
await t("getTile: directories are cached (leaf fetched once)", async () => {
  const { file } = buildArchive(); const f = fakeFetch(file);
  const p = pm.openPMTiles("x://a.pmtiles", { fetchFn: f });
  await p.getTile(4, 3, 5); const n1 = f.log.length;       // header + leaf + tile = 3
  eq(n1, 3);
  await p.getTile(4, 9, 2); eq(f.log.length, n1 + 1);       // only the tile
  await p.getTile(4, 3, 5); eq(f.log.length, n1 + 2);
  await Promise.all([p.getTile(14, 4437, 6865), p.getTile(14, 4437, 6865)]);   // root only
});
await t("getTile: uncompressed tiles (code 1) and custom decompress hook", async () => {
  const { file } = buildArchive({ tileComp: 1 });
  const p = pm.openPMTiles("x://a.pmtiles", { fetchFn: fakeFetch(file) });
  ok(same(await p.getTile(14, 4437, 6865), "tile-A-bytes"));
  let used = 0;
  const { file: f2 } = buildArchive();
  const p2 = pm.openPMTiles("x://a.pmtiles", { fetchFn: fakeFetch(f2), decompress: async (b, kind) => { used++; eq(kind, "gzip"); return new Uint8Array(zlib.gunzipSync(b)); } });
  ok(same(await p2.getTile(14, 4437, 6865), "tile-A-bytes")); ok(used >= 2, "decompress used for root dir and tile");
});
await t("getTile: unsupported compression throws; bad magic throws", async () => {
  const { file } = buildArchive({ tileComp: 2 });
  const bad = Buffer.from(file); bad[98] = 3;
  await rejects(pm.openPMTiles("x://a", { fetchFn: fakeFetch(bad) }).getTile(14, 4437, 6865), /compression code 3/);
  const junk = Buffer.from(file); junk[0] = 0x58;
  await rejects(pm.openPMTiles("x://a", { fetchFn: fakeFetch(junk) }).header(), /Not a PMTiles/);
});
await t("getTile: server that ignores Range (HTTP 200 full body) still works", async () => {
  const { file } = buildArchive();
  const full = async (u, o) => { const m = /bytes=(\d+)-(\d+)/.exec(o.headers.Range); return { ok: true, status: 200, arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.length) }; };
  const p = pm.openPMTiles("x://a", { fetchFn: full });
  ok(same(await p.getTile(4, 3, 5), "tile-L1"));
});
await t("default decompress (DecompressionStream) reads a gzip archive", async () => {
  const { file } = buildArchive();
  const p = pm.openPMTiles("x://a", { fetchFn: fakeFetch(file) });
  ok(same(await p.getTile(0, 0, 0), "tile-z0"));
});
await t("real buildings tile round-trips through a synthetic archive and decodes", async () => {
  if (!haveFix) return "skip";
  const raw = Buffer.from(fx("buildings_14_4437_6865.mvt"));
  const { file } = buildArchive({ tileA: raw });
  const p = pm.openPMTiles("x://a", { fetchFn: fakeFetch(file) });
  const got = await p.getTile(14, 4437, 6865);
  eq(Buffer.compare(Buffer.from(got), raw), 0, "bytes");
  ok(mvt.decodeTile(got).building.features.length > 100);
});

// ---------------------------------------------------------------- mvt
console.log(" mvt");
// tiny protobuf writer
const zig = n => (n < 0 ? -2 * n - 1 : 2 * n);
const tag = (f, w) => wv(f * 8 + w);
const lenField = (f, bytes) => [...tag(f, 2), ...wv(bytes.length), ...bytes];
const strField = (f, s) => lenField(f, [...Buffer.from(s)]);
const varField = (f, n) => [...tag(f, 0), ...wv(n)];
const f32 = x => { const b = Buffer.alloc(4); b.writeFloatLE(x); return [...b]; };
const f64 = x => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
const int64Neg = n => { let v = BigInt.asUintN(64, BigInt(n)); const o = []; while (v >= 128n) { o.push(Number(v & 127n) | 128); v >>= 7n; } o.push(Number(v)); return o; };
const geomMove = (n, pts) => [(n << 3) | 1, ...pts.flatMap(([dx, dy]) => [zig(dx), zig(dy)])];
const geomLine = (n, pts) => [(n << 3) | 2, ...pts.flatMap(([dx, dy]) => [zig(dx), zig(dy)])];
const CLOSE = [(1 << 3) | 7];
const packed = (f, arr) => lenField(f, arr.flatMap(wv));

function syntheticTile() {
  const values = [
    strField(1, "abc"),                 // 0
    [...tag(3, 1), ...f64(12.5)],       // 1 double
    varField(7, 1),                     // 2 bool true
    [...tag(6, 0), ...wv(zig(-5))],     // 3 sint -5
    [...tag(4, 0), ...int64Neg(-7)],    // 4 int64 -7
    [...tag(2, 5), ...f32(1.5)],        // 5 float
    varField(5, 99),                    // 6 uint 99
    strField(1, "héllo"),               // 7
    varField(7, 0),                     // 8 bool false
  ];
  const keys = ["id", "height", "flag", "s", "i", "f", "u", "name", "off"];
  const sq = [[10, 10], [20, 0], [0, 20], [-20, 0]];                      // exterior, positive area
  const hole = [[5, 5], [0, 10], [10, 0], [0, -10]];                      // cursor starts at (10,30) after the exterior -> hole at (15,35)
  const polyGeom = [...geomMove(1, [sq[0]]), ...geomLine(3, sq.slice(1)), ...CLOSE,
                    ...geomMove(1, [[5 - 0, 5]]), ...geomLine(3, [[0, 10], [10, 0], [0, -10]]), ...CLOSE];
  // after exterior the cursor is at (10, 30) => hole start (15, 35), then (15,45), (25,45), (25,35): winding reversed
  const feat1 = [
    ...varField(1, 7), ...packed(2, [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]), ...varField(3, 3), ...packed(4, polyGeom),
  ];
  const feat2 = [...varField(1, 42), ...packed(2, [3, 3]), ...varField(3, 1), ...packed(4, [...geomMove(2, [[3, 4], [-1, -2]])])];
  const feat3 = [...packed(2, []), ...varField(3, 2), ...packed(4, [...geomMove(1, [[0, 0]]), ...geomLine(2, [[10, 0], [0, 10]]), ...geomMove(1, [[100, 100]]), ...geomLine(1, [[5, 5]])])];
  const layer = [
    ...strField(1, "building"),
    ...lenField(2, feat1), ...lenField(2, feat2), ...lenField(2, feat3),
    ...keys.flatMap(k => strField(3, k)),
    ...values.flatMap(v => lenField(4, v)),
    ...varField(5, 8192), ...varField(15, 2),
  ];
  const layer2 = [...strField(1, "empty"), ...varField(15, 2)];
  return new Uint8Array([...lenField(3, layer), ...lenField(3, layer2)]);
}
await t("decodeTile: hand-built tile, all value types, extent, ids", () => {
  const tile = mvt.decodeTile(syntheticTile());
  eq(Object.keys(tile).join(), "building,empty");
  eq(tile.building.extent, 8192); eq(tile.empty.extent, 4096); eq(tile.empty.features.length, 0);
  eq(tile.building.features.length, 3);
  const f = tile.building.features[0];
  eq(f.type, 3);
  const p = f.properties;
  eq(p.id, "abc"); eq(p.height, 12.5); eq(p.flag, true); eq(p.s, -5); eq(p.i, -7); eq(p.f, 1.5); eq(p.u, 99); eq(p.name, "héllo"); eq(p.off, false);
  eq(f.id, "abc", "feature id = properties.id");
  const g = tile.building.features[1];
  eq(g.id, 42, "numeric feature id when no id property"); eq(g.type, 1);
  eq(JSON.stringify(g.geometry), JSON.stringify([[3, 4], [2, 2]]));
});
await t("decodeTile: polygon rings (cursor persists), lines split on MoveTo", () => {
  const tile = mvt.decodeTile(syntheticTile());
  const rings = tile.building.features[0].geometry;
  eq(rings.length, 2);
  eq(JSON.stringify(rings[0]), JSON.stringify([[10, 10], [30, 10], [30, 30], [10, 30]]));
  eq(JSON.stringify(rings[1]), JSON.stringify([[15, 35], [15, 45], [25, 45], [25, 35]]));
  const lines = tile.building.features[2].geometry;
  eq(lines.length, 2); eq(JSON.stringify(lines[0]), JSON.stringify([[0, 0], [10, 0], [10, 10]]));
  eq(JSON.stringify(lines[1]), JSON.stringify([[110, 110], [115, 115]]));   // cursor carried from (10,10)
});
await t("classifyRings: exterior has positive shoelace area (y down); holes join the latest outer", () => {
  const outer = [[10, 10], [30, 10], [30, 30], [10, 30]];
  near(mvt.ringArea(outer), 400);
  const hole = [[15, 35], [15, 45], [25, 45], [25, 35]];
  const hole2 = [[12, 12], [12, 20], [20, 20], [20, 12]];
  const outer2 = [[100, 100], [140, 100], [140, 140], [100, 140]];
  const r = mvt.classifyRings([outer, hole2, outer2, [[0, 0], [5, 5], [10, 10]], [[1, 1], [2, 2], [3, 3]]]);
  eq(r.length, 2); eq(r[0].holes.length, 1); eq(r[1].holes.length, 0);
  eq(r[0].outer, outer); eq(r[1].outer, outer2);
  // leading negative ring is kept as an outer (reversed)
  const odd = mvt.classifyRings([hole2]); eq(odd.length, 1); ok(mvt.ringArea(odd[0].outer) > 0);
});
await t("decodeTile: truncated data throws", () => {
  const b = syntheticTile();
  throws(() => mvt.decodeTile(b.subarray(0, 30)), /MVT/);
});

// --- real fixtures
function sameFeatureAsRef(mine, ref, n, label) {
  eq(mine.features.length, ref.length, label + " count");
  for (let i = 0; i < Math.min(n, ref.length); i++) {
    const rf = ref.feature(i), mf = mine.features[i];
    eq(mf.type, rf.type, `${label}[${i}] type`);
    eq(JSON.stringify(mf.properties), JSON.stringify(rf.properties), `${label}[${i}] props`);
    const rg = rf.loadGeometry();
    if (mf.type === 1) {
      eq(mf.geometry.length, rg.length, `${label}[${i}] points`);
      mf.geometry.forEach((p, k) => { eq(p[0], rg[k][0].x); eq(p[1], rg[k][0].y); });
    } else {
      eq(mf.geometry.length, rg.length, `${label}[${i}] parts`);
      mf.geometry.forEach((part, k) => {
        let r = rg[k].map(q => [q.x, q.y]);
        if (mf.type === 3) r = r.slice(0, -1);               // reference repeats the closing point
        eq(JSON.stringify(part), JSON.stringify(r), `${label}[${i}] part ${k}`);
      });
    }
  }
}
const FILES = ["buildings_14_4437_6865", "buildings_14_4437_6866", "transportation_14_4437_6865", "transportation_14_4437_6866", "base_13_2218_3432", "base_13_2218_3433"];
await t("real tiles decode: layers present, ids, types", () => {
  if (!haveFix) return "skip";
  const b = mvt.decodeTile(fx("buildings_14_4437_6865.mvt"));
  ok(b.building && b.building.features.length > 100, "buildings");
  eq(b.building.extent, 4096);
  const f0 = b.building.features[0];
  eq(f0.type, 3); eq(typeof f0.id, "string"); eq(f0.id, f0.properties.id);
  const tr = mvt.decodeTile(fx("transportation_14_4437_6865.mvt"));
  ok(tr.segment && tr.segment.features.length > 100);
  ok(tr.segment.features.some(f => f.type === 2 && f.properties.class));
  const base = mvt.decodeTile(fx("base_13_2218_3432.mvt"));
  ok(base.land && base.water, "base layers: " + Object.keys(base));
  ok(base.land.features.some(f => f.type === 1 && f.properties.class === "tree"), "tree points");
});
await t("winding: outer rings come out with positive area on real buildings (most polygons have exactly one exterior)", () => {
  if (!haveFix) return "skip";
  const feats = mvt.decodeTile(fx("buildings_14_4437_6865.mvt")).building.features;
  let withHoles = 0, firstPositive = 0, polys = 0;
  for (const f of feats) {
    if (f.type !== 3 || !f.geometry.length) continue;
    polys++;
    if (mvt.ringArea(f.geometry[0]) > 0) firstPositive++;
    const c = mvt.classifyRings(f.geometry);
    if (c.some(p => p.holes.length)) withHoles++;
  }
  eq(firstPositive, polys, "first ring of every building is an exterior (positive area)");
  ok(withHoles > 0, "some real buildings have courtyards/holes; negative rings are classified as holes");
});
await t("first building ring converts to lon/lat inside the Tampa test area", () => {
  if (!haveFix) return "skip";
  const tile = mvt.decodeTile(fx("buildings_14_4437_6865.mvt")).building;
  const f = tile.features.find(q => q.type === 3 && q.geometry.length);
  const { outer } = mvt.classifyRings(f.geometry)[0];
  for (const [px, py] of outer) {
    const [lon, lat] = geo.tileToLonLat(14, 4437, 6865, px, py, tile.extent);
    ok(lon > -82.53 && lon < -82.47, "lon " + lon);
    ok(lat > 27.93 && lat < 27.97, "lat " + lat);
  }
});
await t("cross-check vs @mapbox/vector-tile: counts, properties, geometry (first 50 features per layer)", async () => {
  if (!haveFix || !haveRef) return "skip";
  const { VectorTile } = await import(SQ + "/@mapbox/vector-tile/index.js");
  const Pbf = (await import(SQ + "/pbf/index.js")).default;
  let layersChecked = 0;
  for (const name of FILES) {
    const bytes = fx(name + ".mvt");
    const ref = new VectorTile(new Pbf(bytes)).layers, mine = mvt.decodeTile(bytes);
    eq(Object.keys(mine).sort().join(), Object.keys(ref).sort().join(), name + " layer names");
    for (const ln of Object.keys(ref)) {
      eq(mine[ln].extent, ref[ln].extent, `${name}/${ln} extent`);
      sameFeatureAsRef(mine[ln], ref[ln], 50, `${name}/${ln}`);
      layersChecked++;
    }
  }
  ok(layersChecked >= 8, "layers checked " + layersChecked);
});
await t("cross-check vs reference: geometry of ALL features in one buildings tile", async () => {
  if (!haveFix || !haveRef) return "skip";
  const { VectorTile } = await import(SQ + "/@mapbox/vector-tile/index.js");
  const Pbf = (await import(SQ + "/pbf/index.js")).default;
  const bytes = fx("buildings_14_4437_6866.mvt");
  const ref = new VectorTile(new Pbf(bytes)).layers.building;
  sameFeatureAsRef(mvt.decodeTile(bytes).building, ref, ref.length, "all");
});

// ---------------------------------------------------------------- tiff
console.log(" tiff");
/** Build a minimal single-band float32 GeoTIFF. layout: "tiles" | "strips". */
function makeTiff({ le = true, layout = "tiles", width = 5, height = 4, tw = 4, th = 4, rps = 3, value = (c, r) => c + r * 10, scaleX = 0.001, scaleY = 0.001, tieI = 0, tieJ = 0, tieX = -82.5, tieY = 28 } = {}) {
  const chunks = [];                                            // image data chunks
  const f4 = x => { const b = Buffer.alloc(4); le ? b.writeFloatLE(x) : b.writeFloatBE(x); return b; };
  if (layout === "tiles") {
    for (let ty = 0; ty < Math.ceil(height / th); ty++) for (let tx = 0; tx < Math.ceil(width / tw); tx++) {
      const parts = [];
      for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) { const X = tx * tw + c, Y = ty * th + r; parts.push(f4(X < width && Y < height ? value(X, Y) : -99999)); }
      chunks.push(Buffer.concat(parts));
    }
  } else {
    for (let y0 = 0; y0 < height; y0 += rps) {
      const parts = [];
      for (let r = y0; r < Math.min(height, y0 + rps); r++) for (let c = 0; c < width; c++) parts.push(f4(value(c, r)));
      chunks.push(Buffer.concat(parts));
    }
  }
  // layout: header(8) | image chunks | extra arrays | IFD
  let pos = 8; const chunkOff = chunks.map(c => { const o = pos; pos += c.length; return o; });
  const u16 = n => { const b = Buffer.alloc(2); le ? b.writeUInt16LE(n) : b.writeUInt16BE(n); return b; };
  const u32 = n => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b; };
  const f8 = x => { const b = Buffer.alloc(8); le ? b.writeDoubleLE(x) : b.writeDoubleBE(x); return b; };
  const extra = []; const addExtra = buf => { const o = pos; extra.push(buf); pos += buf.length; return o; };
  const offsArr = addExtra(Buffer.concat(chunkOff.map(u32)));
  const lenArr = addExtra(Buffer.concat(chunks.map(c => u32(c.length))));
  const scaleOff = addExtra(Buffer.concat([f8(scaleX), f8(scaleY), f8(0)]));
  const tieOff = addExtra(Buffer.concat([f8(tieI), f8(tieJ), f8(0), f8(tieX), f8(tieY), f8(0)]));
  const entries = [];
  const E = (tg, type, n, val) => entries.push({ tg, buf: Buffer.concat([u16(tg), u16(type), u32(n), val]) });
  const short = v => Buffer.concat([u16(v), u16(0)]), long = v => u32(v);
  E(256, 4, 1, long(width)); E(257, 4, 1, long(height)); E(258, 3, 1, short(32)); E(259, 3, 1, short(1)); E(277, 3, 1, short(1)); E(284, 3, 1, short(1));
  if (layout === "tiles") { E(322, 4, 1, long(tw)); E(323, 4, 1, long(th)); E(324, 4, chunks.length, long(offsArr)); E(325, 4, chunks.length, long(lenArr)); }
  else { E(273, 4, chunks.length, long(offsArr)); E(278, 4, 1, long(rps)); E(279, 4, chunks.length, long(lenArr)); }
  E(339, 3, 1, short(3)); E(33550, 12, 3, long(scaleOff)); E(33922, 12, 6, long(tieOff));
  entries.sort((a, b) => a.tg - b.tg);
  const ifd = Buffer.concat([u16(entries.length), ...entries.map(e => e.buf), u32(0)]);
  const head = Buffer.concat([Buffer.from(le ? "II" : "MM"), u16(42), u32(pos)]);
  const all = Buffer.concat([head, ...chunks, ...extra, ifd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
await t("readFloatTiff: tiled (edge tiles padded) little endian", () => {
  const d = tiff.readFloatTiff(makeTiff({ layout: "tiles" }));
  eq(d.width, 5); eq(d.height, 4);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) eq(d.data[r * 5 + c], c + r * 10, `px ${c},${r}`);
  near(d.west, -82.5, 1e-12); near(d.north, 28, 1e-12); near(d.pixelW, 0.001, 1e-12); near(d.pixelH, 0.001, 1e-12);
});
await t("readFloatTiff: strips, big endian, multiple strips", () => {
  for (const le of [true, false]) {
    const d = tiff.readFloatTiff(makeTiff({ layout: "strips", le, width: 5, height: 7, rps: 3 }));
    eq(d.height, 7);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) eq(d.data[r * 5 + c], c + r * 10, `le=${le} px ${c},${r}`);
  }
  const m = tiff.readFloatTiff(makeTiff({ layout: "tiles", le: false, width: 9, height: 6, tw: 4, th: 4 }));
  eq(m.data[5 * 9 + 8], 8 + 50);
});
await t("readFloatTiff: tiepoint not at the pixel origin shifts west/north", () => {
  const d = tiff.readFloatTiff(makeTiff({ tieI: 2, tieJ: 3, tieX: -82.498, tieY: 27.997 }));
  near(d.west, -82.498 - 2 * 0.001, 1e-12); near(d.north, 27.997 + 3 * 0.001, 1e-12);
  near(d.east, d.west + 5 * 0.001, 1e-12); near(d.south, d.north - 4 * 0.001, 1e-12);
});
await t("readFloatTiff: clear errors for unsupported input", () => {
  throws(() => tiff.readFloatTiff(new TextEncoder().encode("<html>error</html>").buffer), /Not a TIFF/);
  const bad = Buffer.from(makeTiff()); bad.writeUInt16LE(43, 2);
  throws(() => tiff.readFloatTiff(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.length)), /BigTIFF/);
  throws(() => tiff.readFloatTiff(new ArrayBuffer(4)), /small/);
  // compression tag -> 8
  const buf = Buffer.from(makeTiff()); const ifd = buf.readUInt32LE(4), n = buf.readUInt16LE(ifd);
  for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (buf.readUInt16LE(e) === 259) buf.writeUInt16LE(8, e + 8); }
  throws(() => tiff.readFloatTiff(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), /Compressed/);
});
await t("sampleBilinear: pixel centers, midpoints, outside, no-data", () => {
  const d = tiff.readFloatTiff(makeTiff({ layout: "strips", width: 5, height: 4 }));   // value = c + 10 r
  const lon = c => d.west + (c + 0.5) * d.pixelW, lat = r => d.north - (r + 0.5) * d.pixelH;
  near(tiff.sampleBilinear(d, lon(2), lat(1)), 12, 1e-4);
  near(tiff.sampleBilinear(d, lon(2.5), lat(1)), 12.5, 1e-4);
  near(tiff.sampleBilinear(d, lon(2), lat(1.5)), 17, 1e-4);
  near(tiff.sampleBilinear(d, lon(2.25), lat(1.75)), 2.25 + 17.5, 1e-4);
  near(tiff.sampleBilinear(d, d.west + 1e-9, d.north - 1e-9), 0, 1e-4, "inside the outer half pixel uses the edge");
  ok(Number.isNaN(tiff.sampleBilinear(d, d.west - 0.0001, lat(1))));
  ok(Number.isNaN(tiff.sampleBilinear(d, lon(1), d.north + 0.0001)));
  ok(Number.isNaN(tiff.sampleBilinear(d, d.east + 0.0001, lat(1))));
  ok(Number.isNaN(tiff.sampleBilinear(d, lon(1), d.south - 0.0001)));
  d.data[1 * 5 + 2] = -9999;                                                      // one corner no-data -> NaN
  ok(Number.isNaN(tiff.sampleBilinear(d, lon(2.2), lat(1.2))));
  near(tiff.sampleBilinear(d, lon(3.2), lat(2.2)), 3.2 + 22, 1e-4);              // unaffected area
  d.data[0] = NaN; ok(Number.isNaN(tiff.sampleBilinear(d, lon(0.3), lat(0.3))));
});
await t("demRequestUrl: spec format", () => {
  const u = tiff.demRequestUrl({ west: -82.5062799, south: 27.94766715, east: -82.4972604, north: 27.95668665 }, 300, 301);
  eq(u, "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-82.5062799,27.94766715,-82.4972604,27.95668665&bboxSR=4326&imageSR=4326&size=300,301&format=tiff&pixelType=F32&compression=None&interpolation=RSP_BilinearInterpolation&f=image");
});
await t("real DEM fixture: size, georeference, known pixels, bbox", () => {
  if (!haveFix) return "skip";
  const u8 = fx("dem_tampa_300.tif");
  const d = tiff.readFloatTiff(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.length));
  eq(d.width, 300); eq(d.height, 300);
  near(d.data[0], 7.6924, 1e-3); near(d.data[150 * 300 + 150], 6.6862, 1e-3);
  near(d.west, -82.5062799, 1e-7); near(d.east, -82.4972604, 1e-7);
  near(d.south, 27.94766715, 1e-7); near(d.north, 27.956686649999995, 1e-7);
  let mn = Infinity, mx = -Infinity; for (const v of d.data) { if (v < mn) mn = v; if (v > mx) mx = v; }
  near(mn, 4.7375, 1e-3); near(mx, 15.939, 1e-3);
  // value at the center of the site: bilinear near the pixel-150 center
  const lon = d.west + 150.5 * d.pixelW, lat = d.north - 150.5 * d.pixelH;
  near(tiff.sampleBilinear(d, lon, lat), d.data[150 * 300 + 150], 1e-4);
  ok(Number.isNaN(tiff.sampleBilinear(d, d.west - 0.01, d.north)));
  const z = tiff.sampleBilinear(d, -82.50182, 27.9522013); ok(z > 4.7 && z < 16, "site center elevation " + z);
});
await t("cross-check vs geotiff.js: every pixel and the bbox", async () => {
  if (!haveFix || !haveGeotiff) return "skip";
  const { fromArrayBuffer } = await import(SQ + "/geotiff/dist-module/geotiff.js");
  const u8 = fx("dem_tampa_300.tif");
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.length);
  const img = await (await fromArrayBuffer(ab)).getImage();
  const ras = (await img.readRasters())[0], bb = img.getBoundingBox();
  const d = tiff.readFloatTiff(ab);
  eq(d.data.length, ras.length);
  for (let i = 0; i < ras.length; i++) if (d.data[i] !== ras[i]) throw new Error(`pixel ${i}: ${d.data[i]} vs ${ras[i]}`);
  near(d.west, bb[0], 1e-9); near(d.south, bb[1], 1e-9); near(d.east, bb[2], 1e-9); near(d.north, bb[3], 1e-9);
});

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
