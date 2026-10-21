/* ==========================================================================
   SITE: geo
   Local tangent-plane projection, site square, ground grid spacing and
   Web Mercator tile math. Pure functions, no DOM, no imports.

   Units: feet. Local (x, y): x = east, y = north (true north), origin = the
   southwest corner of the site square. See docs/site-tool-spec.md sections 3
   and 4.1.
   ========================================================================== */

/** Feet to meters. */
export const FT = 0.3048;

const RAD = Math.PI / 180;

/**
 * Build the projection frame for a site square centered on (lat, lon).
 * @param {number} lat  center latitude, degrees
 * @param {number} lon  center longitude, degrees
 * @param {number} sizeFt  side of the square, ft
 * @returns {{lat0:number, lon0:number, size:number, half:number, mPerDegLat:number, mPerDegLon:number,
 *   toLocal:(lon:number, lat:number)=>[number,number], toLonLat:(x:number, y:number)=>[number,number],
 *   bbox:(marginFt?:number)=>{west:number, south:number, east:number, north:number}}}
 */
export function makeFrame(lat, lon, sizeFt) {
  const p = lat * RAD;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const mPerDegLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  const half = sizeFt / 2;
  const ftPerDegLat = mPerDegLat / FT, ftPerDegLon = mPerDegLon / FT;
  return {
    lat0: lat, lon0: lon, size: sizeFt, half, mPerDegLat, mPerDegLon,
    toLocal: (lo, la) => [half + (lo - lon) * ftPerDegLon, half + (la - lat) * ftPerDegLat],
    toLonLat: (x, y) => [lon + (x - half) / ftPerDegLon, lat + (y - half) / ftPerDegLat],
    bbox: (marginFt = 0) => {
      const h = half + marginFt;
      return { west: lon - h / ftPerDegLon, south: lat - h / ftPerDegLat, east: lon + h / ftPerDegLon, north: lat + h / ftPerDegLat };
    },
  };
}

/**
 * Ground grid spacing (section 4.1): d = max(10, ceil(S/99*2)/2) ft, n = floor(S/d) + 1 points per side.
 * @param {number} sizeFt
 * @returns {{spacing:number, n:number}}
 */
export function gridSpacing(sizeFt) {
  const spacing = Math.max(10, Math.ceil(sizeFt / 99 * 2) / 2);
  return { spacing, n: Math.floor(sizeFt / spacing) + 1 };
}

/** Web Mercator tile containing (lon, lat) at zoom z (clamped to the valid range). */
export function tileForLonLat(lon, lat, z) {
  const n = Math.pow(2, z);
  const s = Math.sin(Math.max(-85.0511287798, Math.min(85.0511287798, lat)) * RAD);
  const fx = (lon + 180) / 360 * n;
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const clamp = v => Math.max(0, Math.min(n - 1, Math.floor(v)));
  return { x: clamp(fx), y: clamp(fy) };
}

/** All tiles at zoom z that touch the bbox {west, south, east, north}. */
export function tilesForBBox(bbox, z) {
  const a = tileForLonLat(bbox.west, bbox.north, z);   // top-left
  const b = tileForLonLat(bbox.east, bbox.south, z);   // bottom-right
  const out = [];
  for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) out.push({ z, x, y });
  return out;
}

/**
 * Convert a point inside tile (z, x, y) to [lon, lat].
 * @param {number} px  tile unit x (0..extent, left to right)
 * @param {number} py  tile unit y (0..extent, top to bottom)
 * @param {number} extent  tile units across the tile (4096 typical)
 */
export function tileToLonLat(z, x, y, px, py, extent) {
  const n = Math.pow(2, z);
  const wx = (x + px / extent) / n, wy = (y + py / extent) / n;
  return [wx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) / RAD];
}
