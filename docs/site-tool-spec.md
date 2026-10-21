# Site Model — Spec and Module Contracts

Date: October 21, 2026
Owner: Cade (CMRLM)
Status: v1 build spec. Every build agent follows this file exactly.

---

## 1. Purpose

Site Model is a browser tool for conceptual site context. You type an address. The tool downloads free public map data and shows a 3D site: ground, buildings, roads, trees, and water. You download the ground for Revit (CSV) and the other layers as one DXF.

The accuracy target is about 75% of the full `site3d` tool:

| Item | Target |
|---|---|
| Ground elevation | ±3 ft |
| Building height | ±1 floor (±12 ft) |
| Building position | ±10 ft |

Google Maps is a visual reference only. The tool opens a Google Maps link to the same place. The tool never reads Google data, because Google's terms do not allow it.

## 2. Data sources (tested October 21, 2026)

All sources below answer browser requests from any web page (CORS header `Access-Control-Allow-Origin: *`). No key is necessary.

| Data | Source | Request | Notes |
|---|---|---|---|
| Address to point | Nominatim (OpenStreetMap) | `https://nominatim.openstreetmap.org/search?q=…&format=jsonv2&limit=1&countrycodes=us` | One request for each "Go". Do not search while the user types (usage policy). |
| Ground | USGS 3DEP elevation service | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=W,S,E,N&bboxSR=4326&imageSR=4326&size=C,R&format=tiff&pixelType=F32&compression=None&interpolation=RSP_BilinearInterpolation&f=image` | Best data at each place (1 m where it exists, else about 10 m). Values are meters, NAVD88. The server can change the box to keep square pixels: always read the box from the TIFF tags. The TIFF is tiled (128 × 128), not compressed, float32, little endian. |
| Buildings | Overture Maps PMTiles `buildings.pmtiles` | HTTP range requests | Layer `building`. Max zoom 14. Fields used: `id`, `height` (m), `num_floors`, `min_height`, `is_underground`, `@height_source`, `@geometry_source`, `subtype`, `class`. Almost all buildings at Tampa have `height`. |
| Roads | Overture `transportation.pmtiles` | range requests | Layer `segment`. Max zoom 14. Fields: `id`, `subtype` (`road`), `class`, `subclass`, `width_rules` (JSON text, meters), `road_flags` (JSON text: `is_bridge`, `is_tunnel`), `@name`. |
| Trees and water | Overture `base.pmtiles` | range requests | Max zoom 13. Layer `land`: points with `class` `tree`; polygons with `subtype` `forest` (`class` `wood`, `forest`). Layer `water`: polygons (`class` `water`, `pond`, `lake`, `reservoir`, `basin`, `swimming_pool`, `river`) and lines (`stream`, `ditch`, `canal`, `drain`). |

**Overture release.** The bucket keeps only the two newest releases. A fixed release path breaks within weeks. Find the newest release when the tool starts:
`GET https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=tiles/&delimiter=/` → XML with `<Prefix>tiles/2026-09-23.1/</Prefix>` items. Use the last item in sort order. Tile URL: `…/tiles/<release>/<theme>.pmtiles`.

**Credits (show in the tool and in the notes file):** "Elevation: USGS 3D Elevation Program. Buildings, roads, trees, water: Overture Maps Foundation, © OpenStreetMap contributors (ODbL), Microsoft ML Buildings. Geocoding: Nominatim / OpenStreetMap."

## 3. Coordinates and units

- Units: feet (0.3048 m), square feet. Elevations are true NAVD88 feet. Never shift elevations.
- Local plan coordinates `(x, y)`: x = east, y = north (true north). Origin `(0, 0)` = southwest corner of the site square. All values in the site are positive.
- The site square is centered on the address point. Size `S` ft: 500, 1000 (default), 1500, 2000, 3000.
- Projection: local tangent plane at the center point. Use WGS84 meters per degree at the center latitude:
  `mPerDegLat = 111132.954 − 559.822·cos(2φ) + 1.175·cos(4φ)`, `mPerDegLon = 111412.84·cos φ − 93.5·cos(3φ)`.
  Error over 3000 ft is less than 0.1 ft. This is enough for the target.
- Revit grid north is true north. State plane grid north differs by a small angle. The notes file says this.

## 4. Model rules

### 4.1 Ground
- Grid spacing `d = max(10, ceil(S / 99 × 2) / 2)` ft. Points per side `n = floor(S / d) + 1`. Revit keeps every point only up to 10,000 points, so `n² ≤ 10,000`. (S = 1000 → d = 10.5 ft, n = 96.)
- Request the DEM for the site box plus a 50 ft margin. Image size: about 1 pixel per 3 ft, max 1024 per side.
- Value at each grid node: bilinear interpolation of the DEM at the node's lon/lat. A pixel value below −1000 or NaN is "no data". Fill a no-data node with the mean of the valid nodes around it (repeat until full). If all nodes are no data, stop with a clear error.

### 4.2 Tile features (all themes)
- Decode MVT geometry to tile units. Clip each feature to its own tile box `[0, extent]` first. This removes the tile buffer copies.
- Convert tile units to lon/lat (Web Mercator), then to local feet.
- Group pieces by `id`. Polygon pieces with the same id: union them (Clipper). Line pieces: keep them as separate lines.

### 4.3 Buildings
- Keep a building when its footprint centroid is inside the site square. Do not clip footprints. Skip `is_underground = true`.
- Height: `height` × 3.28084 when present; else `num_floors` × 12; else 24 ft. Record the rule: `"data"`, `"floors"`, `"estimate"`.
- Base: the lowest ground value at the footprint vertices and centroid. Solid from `base − 1` to `base + height`.
- Floors shown in the tool: `round(height / 12)`, min 1.

### 4.4 Roads
- Keep `subtype = "road"`. Classes and default pavement widths (ft):

| Class | Width | Class | Width |
|---|---|---|---|
| motorway, trunk | 48 | residential, living_street | 26 |
| primary | 44 | unclassified, unknown | 22 |
| secondary | 36 | service (default) | 14 |
| tertiary | 30 | service + `alley` | 12 |
| any `link` subclass | 16 | service + `parking_aisle` | 20 |
| | | service + `driveway` | 10 |

- Walks layer (separate, off by default): classes `footway`, `pedestrian`, `path`, `steps`, `cycleway`, width 5 ft (`cycleway` 8 ft).
- Width: first value in `width_rules` × 3.28084 when present, else the table value.
- Skip a segment when `is_tunnel` covers more than half of its length.
- Clip lines to the site square.
- Pavement outline: buffer each line by width / 2 (flat ends, round joins), then union all roads (Clipper). Same for walks.
- Draping: densify lines every 10 ft; z = ground + 0.3 ft.

### 4.5 Trees
- Points with `class = "tree"` inside the square: canopy 20 ft wide, total height 30 ft.
- Forest polygons: place trees on a 30 ft grid inside the polygon (clipped to the square), with a fixed small offset pattern so it looks natural. Max 3,000 trees in total.

### 4.6 Water
- Polygons clipped to the square. Water level: lowest ground value at the polygon vertices, plus 0.2 ft.
- Lines (streams, ditches): clip to the square, drape at ground + 0.2 ft.

## 5. Module contracts

Locations (ES modules, no build step, no DOM in any `src/site` module):

```
src/site/geo.js        projection, Web Mercator, site square, grid spacing
src/site/geocode.js    Nominatim request, lat/lon text, Google Maps URL parsing
src/site/pmtiles.js    PMTiles v3 reader (header, directories, tiles), Overture release lookup
src/site/mvt.js        Mapbox Vector Tile decoder (protobuf), tile geometry to lon/lat
src/site/tiff.js       float32 GeoTIFF reader (tiled or strips, no compression) + DEM request URL
src/site/model.js      ground grid, buildings, roads, trees, water (pure, uses ClipperLib)
src/site/exports.js    Revit CSV, DXF (R12), notes Markdown
test/site.*.test.mjs   node tests
```

Clipper: `globalThis.ClipperLib` (clipper-lib 6.4.2), scale feet by 1000 inside each module, the same as the Tower Generator.

Network: every fetch function takes an injected `fetchFn` (default `globalThis.fetch`). Tests pass a fake that reads fixture files.

### 5.1 geo.js
```js
export const FT = 0.3048;
export function makeFrame(lat, lon, sizeFt)
  // → { lat0, lon0, size, half, mPerDegLat, mPerDegLon,
  //     toLocal(lon, lat) → [x, y]   (origin = SW corner, ft),
  //     toLonLat(x, y) → [lon, lat],
  //     bbox(marginFt=0) → { west, south, east, north } }
export function gridSpacing(sizeFt)            // → { spacing, n }   (section 4.1)
export function tileForLonLat(lon, lat, z)     // → { x, y }
export function tilesForBBox(bbox, z)          // → [{ z, x, y }]
export function tileToLonLat(z, x, y, px, py, extent)   // → [lon, lat]
```

### 5.2 geocode.js
```js
export function parseCoordinates(text)
  // "27.9522, -82.5018" or a Google Maps URL (forms: "@lat,lon,17z", "?q=lat,lon", "!3dlat!4dlon", "ll=lat,lon")
  // → { lat, lon } or null. Rejects lat outside 18..72 or lon outside −180..−60 (US) with null.
export async function geocode(text, { fetchFn } = {})
  // parseCoordinates first; else Nominatim → { lat, lon, label } ; throws Error("Address not found") when empty.
export function googleMapsUrl(lat, lon)
  // "https://www.google.com/maps/@?api=1&map_action=map&center=LAT,LON&zoom=18&basemap=satellite"
```

### 5.3 pmtiles.js
```js
export const OVERTURE_BUCKET = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com";
export const OVERTURE_FALLBACK_RELEASE = "2026-09-23.1";
export async function latestOvertureRelease({ fetchFn } = {})   // list → newest; on error → fallback
export function zxyToTileId(z, x, y)                             // Hilbert, PMTiles v3
export function openPMTiles(url, { fetchFn, decompress } = {})
  // → { header() → Promise<header>, getTile(z, x, y) → Promise<Uint8Array|null> }   (decompressed MVT bytes)
  // Range reads with fetchFn(url, { headers: { Range: "bytes=a-b" } }). Caches header, root and leaf directories.
  // decompress(bytes, "gzip") default uses DecompressionStream.
```

### 5.4 mvt.js
```js
export function decodeTile(bytes)
  // → { [layerName]: { extent, features: [{ id, type: 1|2|3, properties, geometry }] } }
  // type 1 point: geometry = [[x,y], …]; type 2 line: [[[x,y],…], …]; type 3 polygon: rings as decoded
  // (outer rings and holes in MVT winding; use classifyRings to group).
export function classifyRings(rings)   // → [{ outer, holes }] using signed area (MVT outer = positive area in tile y-down units)
```
Properties: string, float, double, int, uint, sint, bool values. `id` comes from the `id` property (Overture UUID text) when present.

### 5.5 tiff.js
```js
export function demRequestUrl(bbox, cols, rows)          // section 2 URL
export function readFloatTiff(arrayBuffer)
  // → { width, height, data: Float32Array (row 0 = north), west, north, pixelW, pixelH }
  // From ModelTiepoint (33922) and ModelPixelScale (33550). Supports tiles and strips, compression 1 only,
  // BitsPerSample 32, SampleFormat 3, II and MM byte order. Throws a clear Error otherwise.
export function sampleBilinear(dem, lon, lat)            // → meters or NaN
```

### 5.6 model.js
```js
export function buildGround(frame, dem)
  // → { spacing, n, xs: Float64Array, ys: Float64Array, z: Float64Array (n*n, row-major from south, ft),
  //     min, max, filled /* count of no-data nodes filled */, at(x, y) → ft (bilinear on the grid) }
export function featuresFromTiles(tiles, frame)
  // tiles: [{ z, x, y, layers /* decodeTile output */ }] → { [layer]: [{ id, type, properties, parts /* local ft */ }] }
  // applies section 4.2 (clip to tile box, convert, group by id, union polygons)
export function buildBuildings(features, frame, ground)
  // → [{ id, ring: [[x,y],…] (CCW), holes, base, height, top, floors, rule, source, name }]
export function buildRoads(features, frame, ground, { walks = false } = {})
  // → { segments: [{ id, cls, name, width, line: [[x,y,z],…] }], pavement: MultiPoly, walks: MultiPoly|null }
export function buildTrees(features, frame, ground)    // → [{ x, y, z, canopy, height }]
export function buildWater(features, frame, ground)    // → { areas: [{ ring, holes, level, cls }], lines: [[[x,y,z],…]] }
export function summarize(model)                       // → { buildings, estimated, roadsFt, trees, waterAreas, groundMin, groundMax }
```
`MultiPoly` = `[{ outer: [[x,y],…], holes: [...] }]`, the same as the Tower Generator.

### 5.7 exports.js
```js
export function revitCsv(ground)          // "x,y,z\n" lines, 3 decimals, no header (same as site3d)
export function siteDxf(model)            // DXF R12 (AC1009) text, units feet
export function notesMarkdown(model, meta) // meta: { address, lat, lon, size, release, date }
```
DXF layers: `SITE-BOUNDARY` (closed polyline, z = 0), `TOPO-MESH` (polyface mesh of the ground), `BLDG-DATA` and `BLDG-ESTIMATE` (one closed polyface mesh per building: walls, roof, floor), `ROAD-PAVEMENT` and `WALK-PAVEMENT` (closed polylines, z = 0), `ROAD-CL` (3D polylines, draped), `WATER` (closed polylines at water level), `WATER-LINE` (3D polylines), `TREE` (circle, diameter = canopy, at ground). A polyface mesh holds at most 32,767 vertices; split the topo mesh into bands if necessary.

## 6. Page (`site/index.html`)

- Same look, tokens, and top bar as the Tower Generator. Three.js 0.170.0 and clipper-lib 6.4.2 from jsDelivr. Built by `build/site/build.py` from parts, the same way as the tower.
- Panel: address field + Go, size select, layer toggles (Ground, Buildings, Roads, Walks, Trees, Water), vertical scale (1×, 2×, 3×, 5×), contour lines toggle (2 ft or 5 ft, shader lines), metrics list, progress list, credits.
- Viewport: white model style. Ground is shaded with soft contour lines. Buildings in model white with dark edges; estimated heights in a light warm tint. Roads mid gray, walks light gray, water blue, trees simple round canopies. North arrow. Site square outline.
- Actions: Open in Google Maps, Revit CSV, DXF, Notes, Screenshot (shared `screenshot.js`).
- Progress: one line per step (Address, Ground, Buildings, Roads, Trees and water) with a status. An error on one layer does not stop the other layers.
- Remember the last 8 sites (address, size) in `localStorage` (try/catch).
- `?test` runs the in-page tests, like the tower.

## 7. Model plan

| Part | Model | Reason |
|---|---|---|
| Spec, data tests (this file) | Opus | Decisions that the rest depends on |
| Readers: geo, geocode, pmtiles, mvt, tiff | Sonnet | Fixed formats with clear specs and fixture tests |
| Model and exports | Sonnet | Routine geometry against fixed rules |
| Page and build | Sonnet | Follows the tower pattern |
| Repeated test runs | Haiku | Short repeated checks |
| Tampa comparison and review | Opus | Judgment on accuracy and fit |
