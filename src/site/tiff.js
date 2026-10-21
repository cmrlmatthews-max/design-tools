/* ==========================================================================
   SITE: tiff
   Float32 GeoTIFF reader for the USGS 3DEP export (uncompressed, tiled or
   stripped, little or big endian) and the export request URL. No DOM, no imports.

   Georeferencing: ModelTiepoint (33922) + ModelPixelScale (33550), pixel-is-area.
   west = X - i*scaleX, north = Y + j*scaleY; pixel (col,row) center is at
   (west + (col+0.5)*pixelW, north - (row+0.5)*pixelH). Row 0 = north.
   ========================================================================== */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/**
 * USGS 3DEP ImageServer export URL (float32 TIFF, meters, NAVD88).
 * @param {{west:number, south:number, east:number, north:number}} bbox
 * @param {number} cols  requested width in pixels
 * @param {number} rows  requested height in pixels
 */
export function demRequestUrl(bbox, cols, rows) {
  const f = v => String(+v.toFixed(8));
  return "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage" +
    `?bbox=${f(bbox.west)},${f(bbox.south)},${f(bbox.east)},${f(bbox.north)}&bboxSR=4326&imageSR=4326` +
    `&size=${Math.round(cols)},${Math.round(rows)}&format=tiff&pixelType=F32&compression=None` +
    "&interpolation=RSP_BilinearInterpolation&f=image";
}

/**
 * Read a single-band float32 GeoTIFF.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{width:number, height:number, data:Float32Array, west:number, north:number, pixelW:number, pixelH:number,
 *   east:number, south:number}}  data is row-major, row 0 = north; pixelW/pixelH in degrees (positive).
 * @throws {Error} with a clear message for unsupported files (compression, bit depth, BigTIFF, planar, multi-band, no georeference).
 */
export function readFloatTiff(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 8) throw new Error("TIFF is too small");
  const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
  const le = b0 === 0x49 && b1 === 0x49;
  if (!le && !(b0 === 0x4d && b1 === 0x4d)) throw new Error("Not a TIFF file (the elevation service may have returned an error page)");
  const magic = dv.getUint16(2, le);
  if (magic === 43) throw new Error("BigTIFF is not supported");
  if (magic !== 42) throw new Error("Not a TIFF file");

  const ifd = dv.getUint32(4, le), count = dv.getUint16(ifd, le);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12, tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), n = dv.getUint32(e + 4, le);
    const size = TYPE_SIZE[type];
    if (!size) continue;
    const at = size * n <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    const vals = new Array(n);
    for (let k = 0; k < n; k++) {
      const o = at + k * size;
      vals[k] = type === 3 ? dv.getUint16(o, le) : type === 4 ? dv.getUint32(o, le) : type === 12 ? dv.getFloat64(o, le)
        : type === 11 ? dv.getFloat32(o, le) : type === 1 || type === 7 ? dv.getUint8(o) : type === 8 ? dv.getInt16(o, le) : type === 9 ? dv.getInt32(o, le) : 0;
    }
    tags[tag] = vals;
  }
  const one = (tag, dflt) => (tags[tag] ? tags[tag][0] : dflt);

  const width = one(256), height = one(257);
  if (!width || !height) throw new Error("TIFF has no image size");
  if (one(259, 1) !== 1) throw new Error("Compressed TIFF is not supported (compression " + one(259) + ")");
  if (one(258, 1) !== 32 || one(339, 1) !== 3) throw new Error("TIFF is not 32-bit float elevation data");
  if (one(277, 1) !== 1) throw new Error("TIFF must have one band");
  if (one(284, 1) !== 1) throw new Error("Planar TIFF is not supported");
  if (one(317, 1) !== 1) throw new Error("TIFF predictor is not supported");
  const scale = tags[33550], tie = tags[33922];
  if (!scale || !tie || scale.length < 2 || tie.length < 6) throw new Error("TIFF has no georeference tags");

  const data = new Float32Array(width * height);
  if (tags[324]) {                                     // tiles
    const tw = one(322), th = one(323), offs = tags[324], lens = tags[325] || [];
    const across = Math.ceil(width / tw);
    for (let t = 0; t < offs.length; t++) {
      const x0 = (t % across) * tw, y0 = Math.floor(t / across) * th;
      if (y0 >= height) break;
      const w = Math.min(tw, width - x0), h = Math.min(th, height - y0);
      if (lens[t] !== undefined && lens[t] < w * 4) throw new Error("TIFF tile is truncated");
      for (let r = 0; r < h; r++) {
        let src = offs[t] + r * tw * 4, dst = (y0 + r) * width + x0;
        if (src + w * 4 > dv.byteLength) throw new Error("TIFF data is truncated");
        for (let c = 0; c < w; c++, src += 4) data[dst + c] = dv.getFloat32(src, le);
      }
    }
  } else if (tags[273]) {                              // strips
    const offs = tags[273], rps = one(278, height);
    for (let s = 0; s < offs.length; s++) {
      const y0 = s * rps, h = Math.min(rps, height - y0);
      if (h <= 0) break;
      let src = offs[s];
      if (src + h * width * 4 > dv.byteLength) throw new Error("TIFF data is truncated");
      for (let i = y0 * width, end = (y0 + h) * width; i < end; i++, src += 4) data[i] = dv.getFloat32(src, le);
    }
  } else throw new Error("TIFF has neither tiles nor strips");

  const pixelW = scale[0], pixelH = Math.abs(scale[1]);
  const west = tie[3] - tie[0] * pixelW, north = tie[4] + tie[1] * pixelH;
  return { width, height, data, west, north, pixelW, pixelH, east: west + width * pixelW, south: north - height * pixelH };
}

/**
 * Bilinear sample of the DEM at (lon, lat) using pixel centers.
 * Points outside the image give NaN; points within half a pixel of the outer edge use the edge row/column.
 * @returns {number} meters, or NaN when outside the image or any of the 4 pixels is no data (NaN or < -1000).
 */
export function sampleBilinear(dem, lon, lat) {
  const { width: w, height: h, data } = dem;
  const px = (lon - dem.west) / dem.pixelW, py = (dem.north - lat) / dem.pixelH;   // pixel-edge coordinates
  if (!(px >= 0 && px <= w && py >= 0 && py <= h)) return NaN;
  const fx = Math.min(Math.max(px - 0.5, 0), w - 1), fy = Math.min(Math.max(py - 0.5, 0), h - 1);
  const x0 = Math.min(Math.floor(fx), w - 1), y0 = Math.min(Math.floor(fy), h - 1);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0, ty = fy - y0;
  const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
  for (const v of [a, b, c, d]) if (!(v >= -1000)) return NaN;   // catches NaN too
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
