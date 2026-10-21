/* ==========================================================================
   SITE: pmtiles
   PMTiles v3 reader over HTTP range requests, plus the Overture release
   lookup. No DOM, no imports. Runs in Safari 16.4+ and Node 22.

   Layout: 127-byte header, root directory (gzip), metadata, leaf directories,
   tile data. The first 16384 bytes of the file hold the header and the root
   directory, so one request opens an archive. Directories are cached.

   Network: every function takes an injected `fetchFn` (default globalThis.fetch).
   ========================================================================== */

export const OVERTURE_BUCKET = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com";
export const OVERTURE_FALLBACK_RELEASE = "2026-09-23.1";

const HEADER_BYTES = 127;
const FIRST_READ = 16384;
const MAX_DEPTH = 4;

/**
 * Newest Overture release name, e.g. "2026-09-23.1". Any failure returns OVERTURE_FALLBACK_RELEASE.
 * @param {{fetchFn?: typeof fetch}} [opts]
 * @returns {Promise<string>}
 */
export async function latestOvertureRelease({ fetchFn = globalThis.fetch } = {}) {
  try {
    const res = await fetchFn(`${OVERTURE_BUCKET}/?list-type=2&prefix=tiles/&delimiter=/`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const xml = await res.text();
    const found = [...xml.matchAll(/<Prefix>tiles\/([^<\/]+)\/<\/Prefix>/g)].map(m => m[1]).sort();
    return found.length ? found[found.length - 1] : OVERTURE_FALLBACK_RELEASE;
  } catch {
    return OVERTURE_FALLBACK_RELEASE;
  }
}

/**
 * PMTiles v3 Hilbert tile id for (z, x, y). Exact port of the reference algorithm;
 * valid for z <= 30 (uses 32-bit bit tests, Number arithmetic for the sum).
 */
export function zxyToTileId(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > 30) throw new Error("Tile zoom out of range");
  const n = Math.pow(2, z);
  if (x < 0 || y < 0 || x >= n || y >= n) throw new Error("Tile x/y out of range");
  let acc = (Math.pow(4, z) - 1) / 3;
  for (let a = z - 1; a >= 0; a--) {
    const s = Math.pow(2, a);                 // 1 << a
    const rx = (x & s) ? s : 0, ry = (y & s) ? s : 0;
    // ((3*rx) ^ ry) << a  ==  quadrant * 4^a
    acc += (rx ? (ry ? 2 : 3) : (ry ? 1 : 0)) * s * s;
    if (ry === 0) {                            // rotate
      if (rx !== 0) { x = s - 1 - x; y = s - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return acc;
}

/** Default decompressor: gzip via DecompressionStream. */
async function defaultDecompress(bytes, kind) {
  if (kind !== "gzip") throw new Error("Unsupported decompression: " + kind);
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return new Uint8Array(buf);
}

/** Read a varint as a Number (exact below 2^53). Returns the value and advances `st.pos`. */
function varint(buf, st) {
  let val = 0, mul = 1, b;
  do {
    b = buf[st.pos++];
    if (b === undefined) throw new Error("PMTiles directory is truncated");
    val += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return val;
}

/** Parse an already decompressed directory into entry arrays (sorted by tile id). */
function parseDirectory(buf) {
  const st = { pos: 0 };
  const count = varint(buf, st);
  const tileId = new Array(count), runLength = new Array(count), length = new Array(count), offset = new Array(count);
  let last = 0;
  for (let i = 0; i < count; i++) { last += varint(buf, st); tileId[i] = last; }
  for (let i = 0; i < count; i++) runLength[i] = varint(buf, st);
  for (let i = 0; i < count; i++) length[i] = varint(buf, st);
  for (let i = 0; i < count; i++) {
    const v = varint(buf, st);
    offset[i] = (v === 0 && i > 0) ? offset[i - 1] + length[i - 1] : v - 1;
  }
  return { count, tileId, runLength, length, offset };
}

/** Entry with the largest tile id <= target that covers it (or a leaf pointer), else null. */
function findEntry(dir, target) {
  let lo = 0, hi = dir.count - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dir.tileId[mid] <= target) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  const run = dir.runLength[best];
  if (run === 0) return { leaf: true, offset: dir.offset[best], length: dir.length[best] };
  if (target < dir.tileId[best] + run) return { leaf: false, offset: dir.offset[best], length: dir.length[best] };
  return null;
}

function parseHeader(dv) {
  const magic = String.fromCharCode(...new Uint8Array(dv.buffer, dv.byteOffset, 7));
  if (magic !== "PMTiles") throw new Error("Not a PMTiles file");
  if (dv.getUint8(7) !== 3) throw new Error("Unsupported PMTiles version " + dv.getUint8(7));
  const u64 = o => Number(dv.getBigUint64(o, true));
  const e7 = o => dv.getInt32(o, true) / 1e7;
  return {
    version: 3,
    rootDirOffset: u64(8), rootDirLength: u64(16),
    metadataOffset: u64(24), metadataLength: u64(32),
    leafDirsOffset: u64(40), leafDirsLength: u64(48),
    tileDataOffset: u64(56), tileDataLength: u64(64),
    numAddressedTiles: u64(72), numTileEntries: u64(80), numTileContents: u64(88),
    clustered: dv.getUint8(96) === 1,
    internalCompression: dv.getUint8(97), tileCompression: dv.getUint8(98), tileType: dv.getUint8(99),
    minZoom: dv.getUint8(100), maxZoom: dv.getUint8(101),
    minLon: e7(102), minLat: e7(106), maxLon: e7(110), maxLat: e7(114),
  };
}

/**
 * Open a PMTiles v3 archive.
 * @param {string} url
 * @param {{fetchFn?: typeof fetch, decompress?: (bytes:Uint8Array, kind:"gzip")=>Promise<Uint8Array>}} [opts]
 * @returns {{header: ()=>Promise<object>, getTile: (z:number,x:number,y:number)=>Promise<Uint8Array|null>}}
 *   getTile returns decompressed tile bytes (MVT) or null when the archive has no such tile.
 */
export function openPMTiles(url, { fetchFn = globalThis.fetch, decompress = defaultDecompress } = {}) {
  let opening = null;          // Promise<{header, first: Uint8Array}>
  const dirCache = new Map();  // "offset:length" -> Promise<dir>

  async function range(offset, length) {
    const res = await fetchFn(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!res.ok && res.status !== 206) throw new Error(`PMTiles request failed (HTTP ${res.status})`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200 && bytes.length > length) bytes = bytes.subarray(offset, offset + length);   // server ignored Range
    return bytes;
  }

  async function unpack(bytes, code) {
    if (code === 1) return bytes;
    if (code === 2) return decompress(bytes, "gzip");
    throw new Error("Unsupported PMTiles compression code " + code);
  }

  function open() {
    if (!opening) {
      opening = range(0, FIRST_READ).then(first => {
        if (first.length < HEADER_BYTES) throw new Error("PMTiles header is truncated");
        const header = parseHeader(new DataView(first.buffer, first.byteOffset, HEADER_BYTES));
        return { header, first };
      });
      opening.catch(() => { opening = null; });   // allow a retry after a network error
    }
    return opening;
  }

  function directory(h, first, offset, length, isRoot) {
    const key = offset + ":" + length;
    if (!dirCache.has(key)) {
      const p = (async () => {
        const bytes = (isRoot && offset + length <= first.length) ? first.subarray(offset, offset + length) : await range(offset, length);
        return parseDirectory(await unpack(bytes, h.internalCompression));
      })();
      dirCache.set(key, p);
      p.catch(() => dirCache.delete(key));
    }
    return dirCache.get(key);
  }

  return {
    header: async () => (await open()).header,
    async getTile(z, x, y) {
      const { header: h, first } = await open();
      if (z < h.minZoom || z > h.maxZoom) return null;
      const target = zxyToTileId(z, x, y);
      let dir = await directory(h, first, h.rootDirOffset, h.rootDirLength, true);
      for (let depth = 0; depth <= MAX_DEPTH; depth++) {
        const e = findEntry(dir, target);
        if (!e) return null;
        if (!e.leaf) {
          const bytes = await range(h.tileDataOffset + e.offset, e.length);
          return unpack(bytes, h.tileCompression);
        }
        dir = await directory(h, first, h.leafDirsOffset + e.offset, e.length, false);
      }
      throw new Error("PMTiles directory nesting is too deep");
    },
  };
}
