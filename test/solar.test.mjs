// Run: node test/solar.test.mjs
// Plan: docs/tower-project-sun-plan.md, section 9.1 tests 7 to 12 (reference values in section 8.2).
const S = await import("../src/shared/solar.js");
const { ATLANTA, sunPosition, tzOffset, localToUTC, sunTimes, dayPath, localBearing } = S;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const hm = (h, m) => 60 * h + m;

console.log("solar position, sun times, time zones");

const LAT = 33.75, LON = -84.39;

/* ------------------------------------------------------------- test 7 */
// Section 8.2 table (NOAA equations and PyEphem agree within 0.01°); tolerance 0.2°.
const POS = [
  ["2026-03-20", hm(12, 0), "2026-03-20T16:00:00.000Z", 138.41, 48.26],
  ["2026-06-21", hm(9, 0), "2026-06-21T13:00:00.000Z", 79.79, 28.96],
  ["2026-06-21", hm(12, 0), "2026-06-21T16:00:00.000Z", 108.87, 65.96],
  ["2026-12-21", hm(12, 0), "2026-12-21T17:00:00.000Z", 170.31, 32.21],
  ["2026-12-21", hm(15, 0), "2026-12-21T20:00:00.000Z", 216.01, 23.35],
];
t("7 five reference positions in Atlanta within 0.2°", () => {
  for (const [d, m, utc, az, alt] of POS) {
    const when = localToUTC(d, m, "us-eastern");
    eq(when.toISOString(), utc, `${d} ${m} UTC`);
    const p = sunPosition(LAT, LON, when);
    ok(angleDiff(p.azimuth, az) <= 0.2, `${d} ${m} azimuth ${p.azimuth} vs ${az}`);
    near(p.altitude, alt, 0.2, `${d} ${m} altitude`);
    ok(p.altitude > p.altitudeGeometric, "refraction lifts the sun");
  }
});
t("7 sunPosition takes a Date or ms; returns every key", () => {
  const ms = Date.UTC(2026, 2, 20, 16, 0);
  const a = sunPosition(LAT, LON, ms), b = sunPosition(LAT, LON, new Date(ms));
  eq(a.azimuth, b.azimuth);
  for (const k of ["azimuth", "altitude", "altitudeGeometric", "declination", "eot"]) ok(Number.isFinite(a[k]), k);
  near(a.declination, 0, 0.3, "equinox declination");
});

/* ------------------------------------------------------------- test 8 */
// Sunrise and sunset, tolerance 2 minutes. The section 8.2 sunrise table is about 4 minutes too early at
// sunrise and too late at sunset (a day 8.5 minutes long); these values are the same equations checked
// against published Atlanta tables (timeanddate.com: 2026-01-20 sunrise 7:40, sunset 5:56).
const TIMES = [
  ["2026-03-20", hm(7, 41), hm(19, 49), 12 * 60 + 8.1],
  ["2026-06-21", hm(6, 27), hm(20, 51), 14 * 60 + 24.0],
  ["2026-12-21", hm(7, 38), hm(17, 33), 9 * 60 + 54.6],
  ["2026-01-20", hm(7, 40.6), hm(17, 56.9), null],
];
t("8 sunrise and sunset within 2 minutes", () => {
  for (const [d, rise, set, len] of TIMES) {
    const s = sunTimes(LAT, LON, d, "us-eastern");
    near(s.sunrise, rise, 2, `${d} sunrise`);
    near(s.sunset, set, 2, `${d} sunset`);
    if (len !== null) near(s.sunset - s.sunrise, len, 1, `${d} day length`);
    eq(s.polar, null);
  }
});
t("8 solar noon 2026-03-20: 13:45 EDT, altitude 56.30°, azimuth 180°", () => {
  const s = sunTimes(LAT, LON, "2026-03-20", "us-eastern");
  near(s.noon, hm(13, 45), 2, "noon");
  const p = sunPosition(LAT, LON, localToUTC("2026-03-20", s.noon, "us-eastern"));
  near(p.altitude, 56.30, 0.05, "noon altitude");
  near(p.azimuth, 180, 0.05, "noon azimuth");
});
t("8 the geometric altitude is −0.833° at sunrise and sunset", () => {
  const s = sunTimes(LAT, LON, "2026-06-21", "us-eastern");
  for (const m of [s.sunrise, s.sunset]) {
    const p = sunPosition(LAT, LON, localToUTC("2026-06-21", m, "us-eastern"));
    near(p.altitudeGeometric, -0.833, 0.03, "geometric altitude at the event");
  }
});

/* ------------------------------------------------------------- test 9 */
t("9 time zones and DST edges (section 8.2)", () => {
  eq(tzOffset("us-eastern", "2026-03-07", 720), -5);
  eq(tzOffset("us-eastern", "2026-03-08", 720), -4);
  eq(tzOffset("us-eastern", "2026-11-01", 90), -4, "repeated hour reads daylight");
  eq(tzOffset("us-eastern", "2026-11-01", 180), -5);
  eq(tzOffset("us-eastern", "2026-03-08", 119), -5, "1:59 standard");
  eq(tzOffset("us-eastern", "2026-03-08", 150), -4, "skipped hour maps forward");
  eq(tzOffset("us-eastern", "2026-11-01", 120), -5, "2:00 standard again");
  eq(tzOffset("us-eastern", "2026-10-31", 1439), -4);
  eq(tzOffset("us-eastern", "2026-11-02", 0), -5);
});
t("9 every zone, fixed offsets, the state.sun.tz shape", () => {
  eq(tzOffset("us-central", "2026-06-21", 720), -5);
  eq(tzOffset("us-central", "2026-12-21", 720), -6);
  eq(tzOffset("us-mountain", "2026-06-21", 720), -6);
  eq(tzOffset("us-pacific", "2026-06-21", 720), -7);
  eq(tzOffset("us-pacific", "2026-01-05", 720), -8);
  eq(tzOffset("us-arizona", "2026-06-21", 720), -7);
  eq(tzOffset("us-arizona", "2026-12-21", 720), -7);
  eq(tzOffset("fixed", "2026-06-21", 720, 9), 9);
  eq(tzOffset("fixed", "2026-06-21", 720), 0);
  eq(tzOffset(5.5, "2026-06-21", 720), 5.5);
  eq(tzOffset({ zone: "us-eastern", offset: -5 }, "2026-06-21", 720), -4);
  eq(tzOffset({ zone: "fixed", offset: 1 }, "2026-06-21", 720), 1);
  // other years: 2027 starts March 14, ends November 7
  eq(tzOffset("us-eastern", "2027-03-13", 720), -5);
  eq(tzOffset("us-eastern", "2027-03-14", 720), -4);
  eq(tzOffset("us-eastern", "2027-11-06", 720), -4);
  eq(tzOffset("us-eastern", "2027-11-07", 720), -5);
});
t("9 localToUTC across DST and past midnight", () => {
  eq(localToUTC("2026-03-07", 720, "us-eastern").toISOString(), "2026-03-07T17:00:00.000Z");
  eq(localToUTC("2026-03-08", 720, "us-eastern").toISOString(), "2026-03-08T16:00:00.000Z");
  eq(localToUTC("2026-11-01", 90, "us-eastern").toISOString(), "2026-11-01T05:30:00.000Z");
  eq(localToUTC("2026-11-01", 180, "us-eastern").toISOString(), "2026-11-01T08:00:00.000Z");
  eq(localToUTC("2026-06-21", 1440, "us-eastern").toISOString(), "2026-06-22T04:00:00.000Z");
  eq(localToUTC("2026-06-21", 600, 2).toISOString(), "2026-06-21T08:00:00.000Z");
});

/* ------------------------------------------------------------ test 10 */
t("10 dayPath: 24-hour path, altitude peaks at solar noon, azimuth 180° at noon", () => {
  const p15 = dayPath(ATLANTA.lat, ATLANTA.lon, "2026-03-20", "us-eastern", 15);
  eq(p15.length, 97);
  eq(p15[0].time, "00:00"); eq(p15[0].minutes, 0);
  eq(p15[96].time, "24:00"); eq(p15[48].time, "12:00");
  for (const k of ["minutes", "time", "azimuth", "altitude"]) ok(k in p15[10], k);
  const path = dayPath(ATLANTA.lat, ATLANTA.lon, "2026-03-20", "us-eastern", 1);
  let best = path[0];
  for (const p of path) if (p.altitude > best.altitude) best = p;
  const s = sunTimes(ATLANTA.lat, ATLANTA.lon, "2026-03-20", "us-eastern");
  near(best.minutes, s.noon, 1.5, "peak time");
  near(best.azimuth, 180, 1, "azimuth at the peak");
  ok(path[0].altitude < 0 && path[path.length - 1].altitude < 0, "night at both ends");
  // default step 15
  eq(dayPath(ATLANTA.lat, ATLANTA.lon, "2026-06-21", "us-eastern").length, 97);
});

/* ------------------------------------------------------------ test 11 */
t("11 polar cases: latitude 80 in June has no sunset, in December no sunrise", () => {
  const jun = sunTimes(80, 0, "2026-06-21", 0);
  eq(jun.sunset, null); eq(jun.sunrise, null); eq(jun.polar, "day");
  ok(Number.isFinite(jun.noon), "noon still given");
  const dec = sunTimes(80, 0, "2026-12-21", 0);
  eq(dec.sunrise, null); eq(dec.sunset, null); eq(dec.polar, "night");
  const south = sunTimes(-80, 0, "2026-12-21", 0);
  eq(south.polar, "day");
  ok(dayPath(80, 0, "2026-06-21", 0, 60).every((p) => p.altitude > 0), "midnight sun all day");
});

/* ------------------------------------------------------------ test 12 */
t("12 localBearing", () => {
  eq(localBearing(180, 90), 270);
  eq(localBearing(300, 90), 30);
  eq(localBearing(10, -30), 340);
  eq(localBearing(0, 0), 0);
  eq(localBearing(359, 721), 0);
});

t("constants and no input mutation", () => {
  eq(ATLANTA.lat, 33.749); eq(ATLANTA.lon, -84.388);
  const tz = Object.freeze({ zone: "us-eastern", offset: -5 });
  sunTimes(LAT, LON, "2026-03-20", tz);
  dayPath(LAT, LON, "2026-03-20", tz, 60);
  eq(tz.offset, -5);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
