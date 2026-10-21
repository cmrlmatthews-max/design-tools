/* ==========================================================================
   SITE: mvt
   Mapbox Vector Tile (protobuf) decoder with its own minimal protobuf reader.
   No DOM, no imports. Geometry stays in integer tile units (y down); use
   geo.tileToLonLat to convert.

   Rings: decodeTile returns polygon rings exactly as encoded, but WITHOUT the
   repeated closing point (ClosePath is implied).
   ========================================================================== */

const TWO32 = 4294967296;
const utf8 = new TextDecoder();

/** Minimal protobuf reader over a Uint8Array. */
class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf; this.pos = pos; this.end = end;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.lo = 0; this.hi = 0;
  }
  /** Unsigned varint up to 64 bits. Returns lo + hi * 2^32 (exact below 2^53); parts kept in this.lo / this.hi. */
  varint() {
    let lo = 0, hi = 0, shift = 0, b;
    do {
      if (this.pos >= this.end) throw new Error("MVT: unexpected end of data");
      b = this.buf[this.pos++];
      const v = b & 0x7f;
      if (shift < 28) lo |= v << shift;
      else if (shift === 28) { lo |= (v & 0x0f) << 28; hi |= v >> 4; }
      else hi |= v << (shift - 32);
      shift += 7;
    } while (b & 0x80 && shift < 70);
    this.lo = lo >>> 0; this.hi = hi >>> 0;
    return this.hi * TWO32 + this.lo;
  }
  /** Signed two's complement int64 (after a varint() call). */
  signed() {
    if (this.hi < 0x80000000) return this.hi * TWO32 + this.lo;
    return -(((~this.hi) >>> 0) * TWO32 + ((~this.lo) >>> 0) + 1);
  }
  /** Zigzag-decoded value of the last varint(). */
  zigzag() {
    const n = this.hi * TWO32 + this.lo;
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
  /** Length-delimited field: returns [start, end] and advances past it. */
  bytes() {
    const len = this.varint(), start = this.pos;
    if (start + len > this.end) throw new Error("MVT: length-delimited field overruns the buffer");
    this.pos = start + len;
    return [start, start + len];
  }
  string() { const [s, e] = this.bytes(); return utf8.decode(this.buf.subarray(s, e)); }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.pos += 4;
    else throw new Error("MVT: unsupported protobuf wire type " + wire);
  }
}

/** Read a packed (or single unpacked) repeated uint32 field into `out`. */
function readPacked(r, wire, out) {
  if (wire === 2) {
    const [s, e] = r.bytes(), p = r.pos, oldEnd = r.end;
    r.pos = s; r.end = e;
    while (r.pos < e) out.push(r.varint());
    r.pos = p; r.end = oldEnd;
  } else out.push(r.varint());
}

function decodeValue(buf, start, end) {
  const r = new Reader(buf, start, end);
  let v = null;
  while (r.pos < end) {
    const tag = r.varint(), f = tag >>> 3, w = tag & 7;
    if (f === 1 && w === 2) v = r.string();
    else if (f === 2 && w === 5) { v = r.dv.getFloat32(r.pos, true); r.pos += 4; }
    else if (f === 3 && w === 1) { v = r.dv.getFloat64(r.pos, true); r.pos += 8; }
    else if (f === 4 && w === 0) { r.varint(); v = r.signed(); }
    else if (f === 5 && w === 0) v = r.varint();
    else if (f === 6 && w === 0) { r.varint(); v = r.zigzag(); }
    else if (f === 7 && w === 0) v = r.varint() !== 0;
    else r.skip(w);
  }
  return v;
}

/** Decode geometry commands into point / line / ring arrays (cursor persists across the feature). */
function decodeGeometry(cmds, type) {
  const out = [];
  let x = 0, y = 0, cur = null, i = 0;
  const zz = n => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);
  while (i < cmds.length) {
    const head = cmds[i++], cmd = head & 7, count = head >>> 3;
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < count; k++) {
        x += zz(cmds[i++]); y += zz(cmds[i++]);
        if (type === 1) out.push([x, y]);
        else if (cmd === 1) { cur = [[x, y]]; out.push(cur); }
        else if (cur) cur.push([x, y]);
      }
    } else if (cmd === 7) {
      // ClosePath: ring is implicitly closed; the next MoveTo starts a new ring.
    } else throw new Error("MVT: unknown geometry command " + cmd);
  }
  return out;
}

function decodeFeature(buf, start, end, keys, values) {
  const r = new Reader(buf, start, end);
  let id = null, type = 0;
  const tags = [], cmds = [];
  while (r.pos < end) {
    const tag = r.varint(), f = tag >>> 3, w = tag & 7;
    if (f === 1 && w === 0) id = r.varint();
    else if (f === 2) readPacked(r, w, tags);
    else if (f === 3 && w === 0) type = r.varint();
    else if (f === 4) readPacked(r, w, cmds);
    else r.skip(w);
  }
  const properties = {};
  for (let i = 0; i + 1 < tags.length; i += 2) properties[keys[tags[i]]] = values[tags[i + 1]];
  return { id: properties.id !== undefined ? properties.id : id, type, properties, geometry: decodeGeometry(cmds, type) };
}

function decodeLayer(buf, start, end) {
  const r = new Reader(buf, start, end);
  let name = "", extent = 4096;
  const keys = [], values = [], feats = [];
  while (r.pos < end) {
    const tag = r.varint(), f = tag >>> 3, w = tag & 7;
    if (f === 1 && w === 2) name = r.string();
    else if (f === 2 && w === 2) feats.push(r.bytes());
    else if (f === 3 && w === 2) keys.push(r.string());
    else if (f === 4 && w === 2) { const [s, e] = r.bytes(); values.push(decodeValue(buf, s, e)); }
    else if (f === 5 && w === 0) extent = r.varint();
    else r.skip(w);
  }
  return { name, extent, features: feats.map(([s, e]) => decodeFeature(buf, s, e, keys, values)) };
}

/**
 * Decode a (decompressed) vector tile.
 * @param {Uint8Array} bytes
 * @returns {Object<string, {extent:number, features:Array<{id:(string|number|null), type:(1|2|3), properties:object, geometry:Array}>}>}
 *   Feature id = properties.id when present, else the numeric feature id.
 *   type 1: geometry = [[x,y], ...]; type 2: [[[x,y], ...], ...]; type 3: rings [[[x,y], ...], ...] in MVT winding,
 *   no repeated closing point. Layers with the same name are merged.
 */
export function decodeTile(bytes) {
  const r = new Reader(bytes);
  const layers = {};
  while (r.pos < r.end) {
    const tag = r.varint(), f = tag >>> 3, w = tag & 7;
    if (f === 3 && w === 2) {
      const [s, e] = r.bytes(), layer = decodeLayer(bytes, s, e);
      if (layers[layer.name]) layers[layer.name].features.push(...layer.features);
      else layers[layer.name] = { extent: layer.extent, features: layer.features };
    } else r.skip(w);
  }
  return layers;
}

/** Signed shoelace area of a ring (tile units, y down). Positive = MVT exterior ring. */
export function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/**
 * Group polygon rings into polygons using winding (MVT spec): a ring with positive shoelace area
 * (in y-down tile units) is an exterior ring; each following negative-area ring is a hole of the latest exterior.
 * Zero-area rings are dropped. A leading negative ring (malformed) is kept as an exterior, reversed.
 * @param {Array<Array<[number,number]>>} rings
 * @returns {Array<{outer:Array<[number,number]>, holes:Array<Array<[number,number]>>}>}
 */
export function classifyRings(rings) {
  const polys = [];
  for (const ring of rings) {
    const a = ringArea(ring);
    if (a === 0 || ring.length < 3) continue;
    if (a > 0) polys.push({ outer: ring, holes: [] });
    else if (polys.length) polys[polys.length - 1].holes.push(ring);
    else polys.push({ outer: ring.slice().reverse(), holes: [] });
  }
  return polys;
}
