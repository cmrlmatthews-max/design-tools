// Solar position, sunrise and sunset, and US time zones for the sun study.
// Source: docs/tower-project-sun-plan.md sections 3.3 and 3.4 (the NOAA Solar Calculator equations, after Meeus).
// Pure ES module: no DOM, no Three.js, inputs never changed. Angles are degrees; times are minutes after
// local midnight unless named otherwise. Azimuth is a compass bearing: 0 = north, clockwise.

export const ATLANTA = { lat: 33.749, lon: -84.388 };

const RAD = Math.PI / 180;
const rad = (d) => d * RAD;
const deg = (r) => r / RAD;
const mod = (a, n) => ((a % n) + n) % n;
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const DAY_MS = 86400000;

const ZONES = {
  "us-eastern": { std: -5, dst: true },
  "us-central": { std: -6, dst: true },
  "us-mountain": { std: -7, dst: true },
  "us-pacific": { std: -8, dst: true },
  "us-arizona": { std: -7, dst: false },
};

/* ----------------------------------------------------------------- dates */

/** "YYYY-MM-DD" (or "MM-DD", read in the current year) → { y, m, d }. */
function parseDate(localDate) {
  if (localDate && typeof localDate === "object" && Number.isFinite(localDate.y)) return { y: localDate.y, m: localDate.m, d: localDate.d };
  const s = String(localDate || "");
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mt) return { y: +mt[1], m: +mt[2], d: +mt[3] };
  mt = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mt) return { y: new Date().getFullYear(), m: +mt[1], d: +mt[2] };
  throw new Error(`solar: bad date "${s}" (use YYYY-MM-DD)`);
}

/** Day number (days since 1970-01-01) of a calendar date. */
const dayNum = ({ y, m, d }) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

/** Calendar date of a day number. */
function fromDayNum(n) {
  const t = new Date(n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Rolls minutes outside 0 … 1440 into the next or previous day. */
function normalize(localDate, localMinutes) {
  const day = dayNum(parseDate(localDate));
  const mins = Number.isFinite(localMinutes) ? localMinutes : 0;
  const k = Math.floor(mins / 1440);
  return { date: fromDayNum(day + k), minutes: mins - k * 1440 };
}

/** Day of month of the nth Sunday of a month (n = 1, 2, …). */
function nthSunday(y, m, n) {
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0 = Sunday
  return 1 + ((7 - dow) % 7) + 7 * (n - 1);
}

/** US daylight time: second Sunday of March 2:00 standard to first Sunday of November 2:00 daylight. */
function usDST(date, minutes) {
  const { y, m, d } = date;
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  if (m === 3) {
    const s = nthSunday(y, 3, 2);
    if (d !== s) return d > s;
    return minutes >= 120;         // 2:00 to 3:00 does not exist; it maps forward to daylight time
  }
  const e = nthSunday(y, 11, 1);
  if (d !== e) return d < e;
  return minutes < 120;            // 1:00 to 2:00 happens twice; the plan reads it as daylight time
}

/** zoneOrOffset: a zone name, a number of hours, or { zone, offset } (the state.sun.tz shape). */
function zoneParts(zoneOrOffset, fixedOffset) {
  if (Number.isFinite(zoneOrOffset)) return { zone: "fixed", offset: zoneOrOffset };
  if (zoneOrOffset && typeof zoneOrOffset === "object") {
    return { zone: String(zoneOrOffset.zone || "fixed"), offset: Number.isFinite(zoneOrOffset.offset) ? zoneOrOffset.offset : (Number.isFinite(fixedOffset) ? fixedOffset : 0) };
  }
  return { zone: String(zoneOrOffset || "fixed"), offset: Number.isFinite(fixedOffset) ? fixedOffset : 0 };
}

/* ------------------------------------------------------------ time zones */

/**
 * Hours from UTC for a local date and time (plan section 3.4). zone: us-eastern | us-central | us-mountain |
 * us-pacific | us-arizona | fixed (then fixedOffset, default 0). zone may also be a number or { zone, offset }.
 * localDate "YYYY-MM-DD"; localMinutes after local midnight (outside 0 … 1440 rolls the date).
 */
export function tzOffset(zone, localDate, localMinutes, fixedOffset) {
  const z = zoneParts(zone, fixedOffset);
  const info = ZONES[z.zone];
  if (!info) return z.offset;
  if (!info.dst) return info.std;
  const { date, minutes } = normalize(localDate, localMinutes);
  return usDST(date, minutes) ? info.std + 1 : info.std;
}

/** Local date and minutes → the UTC instant (a Date). */
export function localToUTC(localDate, localMinutes, zoneOrOffset) {
  const { date, minutes } = normalize(localDate, localMinutes);
  const off = tzOffset(zoneOrOffset, date, minutes);
  return new Date(dayNum(date) * DAY_MS + (minutes - 60 * off) * 60000);
}

/* -------------------------------------------------------- solar position */

/** The date-only parts of the NOAA sheet for an instant (ms): declination, equation of time. */
function solarCore(ms) {
  const JD = ms / DAY_MS + 2440587.5;
  const T = (JD - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + 0.0003032 * T), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = rad(M);
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = rad(125.04 - 1934.136 * T);
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - 0.001813 * T))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega);
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const L0r = rad(L0);
  const eot = 4 * deg(y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eot };
}

/** Atmospheric refraction in degrees for a geometric altitude h (the NOAA sheet). */
function refraction(h) {
  let arcsec;
  if (h > 85) arcsec = 0;
  else if (h > 5) {
    const t = Math.tan(rad(h));
    arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  } else if (h > -0.575) arcsec = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  else arcsec = -20.772 / Math.tan(rad(h));
  return arcsec / 3600;
}

/**
 * Sun position for a place and a UTC instant (Date or ms). Plan section 3.3.
 * → { azimuth (compass, 0 = north, clockwise), altitude (apparent, with refraction), altitudeGeometric,
 *     declination, eot (minutes) }
 */
export function sunPosition(lat, lon, dateUTC) {
  const ms = dateUTC instanceof Date ? dateUTC.getTime() : +dateUTC;
  const { decl, eot } = solarCore(ms);
  const utcMin = mod(ms / 60000, 1440);
  const tst = mod(utcMin + eot + 4 * lon, 1440);
  let H = tst / 4 - 180;
  if (H < -180) H += 360;
  const phi = rad(lat), dr = rad(decl), Hr = rad(H);
  const cosZ = clamp1(Math.sin(phi) * Math.sin(dr) + Math.cos(phi) * Math.cos(dr) * Math.cos(Hr));
  const Z = deg(Math.acos(cosZ));
  const h = 90 - Z;
  const sinZ = Math.sin(rad(Z));
  let azimuth;
  const den = Math.cos(phi) * sinZ;
  if (Math.abs(den) < 1e-12) azimuth = lat > 0 ? 180 : 0;   // sun at the zenith or a pole
  else {
    const a = deg(Math.acos(clamp1((Math.sin(phi) * cosZ - Math.sin(dr)) / den)));
    azimuth = H > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }
  return { azimuth, altitude: h + refraction(h), altitudeGeometric: h, declination: decl, eot };
}

/* ------------------------------------------------------ sunrise / sunset */

/** Hour angle (degrees) of the sun at apparent altitude −0.833°, or ±Infinity for polar day / night. */
function riseHourAngle(lat, decl) {
  const phi = rad(lat), dr = rad(decl);
  const c = (Math.cos(rad(90.833)) - Math.sin(phi) * Math.sin(dr)) / (Math.cos(phi) * Math.cos(dr));
  if (c < -1) return Infinity;    // the sun never sets
  if (c > 1) return -Infinity;    // the sun never rises
  return deg(Math.acos(c));
}

/**
 * Sunrise, solar noon and sunset as local minutes (plan section 3.3). An event that does not happen
 * (polar day or night) is null, and `polar` says which: "day" | "night" | null.
 * → { sunrise, noon, sunset, polar }
 */
export function sunTimes(lat, lon, localDate, zoneOrOffset) {
  const date = parseDate(localDate);
  const day0 = dayNum(date) * DAY_MS;
  const offAt = (mins) => tzOffset(zoneOrOffset, date, mins);
  const utcMs = (localMins) => day0 + (localMins - 60 * offAt(localMins)) * 60000;
  // solar noon, iterated with the equation of time at the event
  let noon = 720 - 4 * lon + 60 * offAt(720);
  for (let i = 0; i < 3; i++) noon = 720 - 4 * lon - solarCore(utcMs(noon)).eot + 60 * offAt(noon);
  const event = (sign) => {
    let t = noon, H0 = 0;
    for (let i = 0; i < 3; i++) {
      const c = solarCore(utcMs(t));
      H0 = riseHourAngle(lat, c.decl);
      if (!Number.isFinite(H0)) return { t: null, polar: H0 > 0 ? "day" : "night" };
      t = 720 - 4 * lon - c.eot + 60 * offAt(t) + sign * 4 * H0;
    }
    return { t, polar: null };
  };
  const rise = event(-1), set = event(1);
  const polar = rise.polar || set.polar;
  return { sunrise: polar ? null : rise.t, noon, sunset: polar ? null : set.t, polar };
}

const hhmm = (mins) => {
  const m = Math.round(mins);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * The sun path over one local day, 0:00 to 24:00 at stepMin (default 15).
 * → [{ minutes, time: "HH:MM", azimuth, altitude }] (altitude apparent; negative below the horizon)
 */
export function dayPath(lat, lon, localDate, zoneOrOffset, stepMin) {
  const step = Number.isFinite(stepMin) && stepMin > 0 ? stepMin : 15;
  const out = [];
  for (let m = 0; m <= 1440 + 1e-9; m += step) {
    const p = sunPosition(lat, lon, localToUTC(localDate, m, zoneOrOffset));
    out.push({ minutes: m, time: hhmm(m), azimuth: p.azimuth, altitude: p.altitude });
  }
  return out;
}

/** A true bearing in the local frame of a placement turned by `rotation` (plan section 3.2): (A + r) mod 360. */
export function localBearing(trueAzimuth, rotation) {
  return mod((+trueAzimuth || 0) + (+rotation || 0), 360);
}
