/* ==========================================================================
   SITE: geocode
   Turn the text in the address box into a point. Accepts "lat, lon" text,
   Google Maps URLs (read as text only; Google data is never fetched), or an
   address (one Nominatim request per call, per the usage policy).

   Network: pass `fetchFn` (default globalThis.fetch). No DOM.
   ========================================================================== */

const inUS = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 18 && lat <= 72 && lon >= -180 && lon <= -60;
const NUM = "(-?\\d+(?:\\.\\d+)?)";

/**
 * Read a coordinate pair out of text.
 * Forms, in priority order (place coordinates beat the map camera):
 *   "!3dLAT!4dLON" (Google place), "@LAT,LON[,17z]", "q=LAT,LON" / "query=" / "ll=" / "center=", "LAT, LON".
 * @param {string} text
 * @returns {{lat:number, lon:number}|null}  null when nothing matches or the point is outside the US box
 *   (lat 18..72, lon -180..-60).
 */
export function parseCoordinates(text) {
  if (typeof text !== "string") return null;
  let s = text.trim();
  try { s = decodeURIComponent(s.replace(/\+/g, "%20")); } catch { /* keep raw */ }
  const patterns = [
    new RegExp("!3d" + NUM + "!4d" + NUM),
    new RegExp("@" + NUM + "\\s*,\\s*" + NUM),
    new RegExp("[?&](?:q|query|ll|center|destination)=\\s*" + NUM + "\\s*,\\s*" + NUM),
    new RegExp("^\\(?\\s*" + NUM + "\\s*(?:,|\\s)\\s*" + NUM + "\\s*\\)?$"),
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    return inUS(lat, lon) ? { lat, lon } : null;
  }
  return null;
}

/**
 * Resolve the address box text to a point.
 * @param {string} text
 * @param {{fetchFn?: typeof fetch}} [opts]
 * @returns {Promise<{lat:number, lon:number, label:string}>}
 * @throws {Error} "Address not found" when Nominatim returns nothing.
 */
export async function geocode(text, { fetchFn = globalThis.fetch } = {}) {
  const pt = parseCoordinates(text);
  if (pt) return { lat: pt.lat, lon: pt.lon, label: `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}` };
  const q = String(text || "").trim();
  if (!q) throw new Error("Address not found");
  const url = "https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(q) + "&format=jsonv2&limit=1&countrycodes=us";
  const res = await fetchFn(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address lookup failed (HTTP " + res.status + ")");
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) throw new Error("Address not found");
  const r = list[0], lat = parseFloat(r.lat), lon = parseFloat(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Address not found");
  return { lat, lon, label: r.display_name || q };
}

/** Google Maps satellite link to the same place (visual reference only). */
export function googleMapsUrl(lat, lon) {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lon}&zoom=18&basemap=satellite`;
}
