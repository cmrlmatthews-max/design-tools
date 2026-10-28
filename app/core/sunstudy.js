/* ==========================================================================
   CORE: sun study (Cade, October 28, 2026)
   The real sun from a date and time at the project place, and the 3 x 3 shadow study sheet
   (March 21, June 21, December 21 at 9 AM, 12 PM and 3 PM local clock time). Ported from build/tower/08d_sun.js
   (SunUI) and build/tower/10b_sunstudy.js (SunStudy).

   Azimuth convention: scene.setSun({ az, alt }) takes a compass bearing (0 = north = plan +y = world -z, clockwise,
   90 = east = plan +x), the same as solar.js sunPosition().azimuth. The project frame is north-up (plan +y is true
   north; the site tool frames by lat and lon with no rotation), so the true bearing passes through unchanged.

   sunPosFor({ lat, lon, date: 'YYYY-MM-DD', time: 'HH:MM', tz }) -> { az, alt, up }
   projectPlace(doc) -> { lat, lon, label, site }
   createSunStudy(scene, { doc, title, dates?, times?, tz?, onProgress? }) -> Promise<Blob> (PNG)
   sunStudyControls(ctx) -> HTMLElement   (the extra View panel controls: Manual / Real sun, date, time, place, button)
   applyRealSun(ctx) -> boolean           (recompute az and alt for Real sun, for example after a project opens)
   ========================================================================== */
import { sunPosition, localToUTC, ATLANTA } from '../../src/shared/solar.js';
import { captureView } from '../../src/shared/screenshot.js';

export const STUDY_DATES = ['03-21', '06-21', '12-21'];
export const STUDY_TIMES = ['09:00', '12:00', '15:00'];
export const DEFAULT_TZ = 'America/New_York';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SOLAR_ZONES = new Set(['us-eastern', 'us-central', 'us-mountain', 'us-pacific', 'us-arizona']);
const IANA_TO_SOLAR = {
  'America/New_York': 'us-eastern', 'America/Detroit': 'us-eastern', 'America/Indiana/Indianapolis': 'us-eastern', 'US/Eastern': 'us-eastern',
  'America/Chicago': 'us-central', 'US/Central': 'us-central',
  'America/Denver': 'us-mountain', 'US/Mountain': 'us-mountain',
  'America/Phoenix': 'us-arizona', 'US/Arizona': 'us-arizona',
  'America/Los_Angeles': 'us-pacific', 'US/Pacific': 'us-pacific',
};
const TZ_TEXT = { 'us-eastern': 'US Eastern', 'us-central': 'US Central', 'us-mountain': 'US Mountain', 'us-pacific': 'US Pacific', 'us-arizona': 'US Arizona' };

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const pad2 = (n) => String(n).padStart(2, '0');
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------------------------------------------------------------- dates and times */

/** Today as 'YYYY-MM-DD' in the device's own calendar. */
export function todayIso(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
/** 'MM-DD' -> 'YYYY-MM-DD' in the current year; a full date passes through. */
const isoOf = (md, year = new Date().getFullYear()) => (/^\d{4}-\d{1,2}-\d{1,2}$/.test(String(md)) ? String(md) : `${year}-${String(md)}`);
/** 'HH:MM' -> minutes after midnight (NaN when not a time). */
export function minutesOf(hm) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim()); return m ? +m[1] * 60 + +m[2] : NaN; }
const hmOf = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
/** Minutes -> "2:30 PM"; short drops ":00" ("9 AM"). */
export function fmtTime(min, short = false) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60), mm = m % 60, ap = hh < 12 ? 'AM' : 'PM', h12 = hh % 12 || 12;
  return short && mm === 0 ? `${h12} ${ap}` : `${h12}:${pad2(mm)} ${ap}`;
}
/** 'YYYY-MM-DD' or 'MM-DD' -> "Jun 21". */
export function fmtDate(s) { const m = /(\d{1,2})-(\d{1,2})$/.exec(String(s || '')); return m ? `${MONTHS[+m[1] - 1] || '?'} ${+m[2]}` : String(s || ''); }

/* ---------------------------------------------------------------- time zones */

/** Hours from UTC of an IANA zone at a UTC instant (Intl). */
function intlOffsetHours(zone, ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUTC - Math.floor(ms / 1000) * 1000) / 3600000;
}

/** A local date and minutes in a zone -> the UTC instant (Date). tz: an IANA zone, a solar.js zone (us-eastern …), or hours from UTC. */
export function localInstant(isoDate, minutes, tz = DEFAULT_TZ) {
  if (fin(tz)) return localToUTC(isoDate, minutes, tz);
  const z = String(tz || DEFAULT_TZ);
  if (SOLAR_ZONES.has(z)) return localToUTC(isoDate, minutes, z);
  if (IANA_TO_SOLAR[z]) return localToUTC(isoDate, minutes, IANA_TO_SOLAR[z]);
  try {
    const [y, mo, d] = isoDate.split('-').map(Number);
    const wall = Date.UTC(y, mo - 1, d) + minutes * 60000;
    let ms = wall - intlOffsetHours(z, wall) * 3600000;
    ms = wall - intlOffsetHours(z, ms) * 3600000;
    return new Date(ms);
  } catch (e) {
    return localToUTC(isoDate, minutes, 'us-eastern');     // unknown zone: Cade's Atlanta time
  }
}

/** A short name for a zone: "US Eastern", "UTC-5", or the IANA name. */
export function tzText(tz = DEFAULT_TZ) {
  if (fin(tz)) return `UTC${tz >= 0 ? '+' : '-'}${Math.abs(tz)}`;
  const z = String(tz || DEFAULT_TZ);
  return TZ_TEXT[IANA_TO_SOLAR[z] || z] || z;
}

/* ---------------------------------------------------------------- sun position */

/**
 * The sun for a place, a local date and a local clock time, in the scene.setSun convention.
 * az: compass bearing toward the sun (0 = north, clockwise). alt: apparent altitude (negative below the horizon).
 */
export function sunPosFor({ lat, lon, date, time, tz = DEFAULT_TZ } = {}) {
  const la = fin(lat) ? lat : ATLANTA.lat, lo = fin(lon) ? lon : ATLANTA.lon;
  const iso = isoOf(date || todayIso());
  const mins = fin(time) ? time : minutesOf(time);
  const utc = localInstant(iso, fin(mins) ? mins : 720, tz);
  const p = sunPosition(la, lo, utc);
  return { az: p.azimuth, alt: p.altitude, up: p.altitude > 0 };
}

/* ---------------------------------------------------------------- place */

const coordText = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

/** The project place: doc.frame (kind 'site'), else the site section, else Atlanta. */
export function projectPlace(doc) {
  const st = doc && doc.sections && doc.sections.site && doc.sections.site.state;
  const named = (() => {
    const t = st && String(st.address || st.query || '').trim();
    return t && !/^https?:/i.test(t) ? t : '';
  })();
  const f = doc && doc.frame;
  if (f && f.kind === 'site' && fin(f.lat) && fin(f.lon)) return { lat: f.lat, lon: f.lon, label: named || coordText(f.lat, f.lon), site: true };
  if (st && fin(st.lat) && fin(st.lon)) return { lat: st.lat, lon: st.lon, label: named || coordText(st.lat, st.lon), site: true };
  return { lat: ATLANTA.lat, lon: ATLANTA.lon, label: 'Atlanta (no site)', site: false };
}

/* ---------------------------------------------------------------- the sheet */

const FONT = '-apple-system, "SF Pro Text", "Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const font = (w, s) => `${w} ${s}px ${FONT}`;
const SHEET_GROUND = '#e4e7ea';
const INK = '#1d2530', INK2 = '#5b6572', LINE = '#d5d9de';
const SHEET_MAX_W = 3600;
const LAY = { margin: 56, gap: 18, head: 200, foot: 64 };
const CELL_W = Math.floor((SHEET_MAX_W - 2 * LAY.margin - 2 * LAY.gap) / 3);   // 1152 px

async function toBitmap(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('A panel could not be read.')); im.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Screen direction of north (plan +y) for the current camera: unit { x, y } in canvas pixels (y down), or null when north points at the viewer. */
function northOnScreen(scene) {
  try {
    const THREE = scene.THREE, cam = scene.camera();
    if (!THREE || !cam) return null;
    cam.updateMatrixWorld(true);
    const t = scene.controls && scene.controls.target ? scene.controls.target.clone() : new THREE.Vector3();
    const a = t.clone().project(cam), b = t.clone().add(new THREE.Vector3(0, 0, -1).multiplyScalar(Math.max(1, cam.position.distanceTo(t) * 0.1))).project(cam);
    const dx = b.x - a.x, dy = -(b.y - a.y);
    const aspect = cam.isPerspectiveCamera ? cam.aspect : ((cam.right - cam.left) / Math.max(1e-9, cam.top - cam.bottom));
    const sx = dx * aspect, len = Math.hypot(sx, dy);
    return len > 0.02 ? { x: sx / len, y: dy / len } : null;
  } catch (e) { return null; }
}

function drawNorth(c, x, y, dir) {
  const r = 26;
  c.save();
  c.translate(x, y);
  c.strokeStyle = LINE; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, r + 8, 0, Math.PI * 2); c.stroke();
  c.rotate(Math.atan2(dir.x, -dir.y));
  c.fillStyle = INK;
  c.beginPath(); c.moveTo(0, -r); c.lineTo(10, r * 0.55); c.lineTo(0, r * 0.25); c.lineTo(-10, r * 0.55); c.closePath(); c.fill();
  c.restore();
  c.fillStyle = INK; c.font = font(700, 20); c.textAlign = 'center';
  c.fillText('N', x, y + r + 34);
}

/** Light ground for the sheet: the drawn site or grading ground turns plain light gray (its theme colors are dark, so the shadows
 *  would not read). Returns restore(). */
const GROUND_KINDS = new Set(['site-ground', 'grading-ground']);
function lightGround(scene) {
  const saved = [];
  try {
    (scene.layerRoot || scene.scene).traverse((o) => {
      const u = o.userData || {};
      if (!o.isMesh || !(GROUND_KINDS.has(u.kind) || u.isGround === true)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !m.color || saved.some((x) => x.m === m)) continue;
        saved.push({ m, color: m.color.clone(), vc: m.vertexColors });
        m.color.set(SHEET_GROUND); m.vertexColors = false; m.needsUpdate = true;
      }
    });
  } catch (e) { console.error(e); }
  return () => saved.forEach(({ m, color, vc }) => { m.color.copy(color); m.vertexColors = vc; m.needsUpdate = true; });
}

let working = false;
const runHooks = (hooks, on) => {
  for (const fn of Array.isArray(hooks) ? hooks : []) { try { if (typeof fn === 'function') fn(on); } catch (e) { console.error(e); } }
};

/**
 * Makes the 3 x 3 shadow study sheet with the current camera and returns a PNG Blob.
 * opts: { doc, title, dates (['MM-DD' | 'YYYY-MM-DD']), times (['HH:MM']), tz, hooks, onProgress(done, total, label) }
 * hooks: as in captureImage, fn(true) before and fn(false) after (pass (on) => ctx.layers.setAiReady(on) for the light AI-ready colors).
 * The sun, the shadows switch and the style come back after, also on an error.
 */
export async function createSunStudy(scene, { doc = null, title = '', dates = STUDY_DATES, times = STUDY_TIMES, tz = DEFAULT_TZ, hooks = [], onProgress } = {}) {
  if (!scene || !scene.renderer) throw new Error('The 3D view is not available.');
  if (working) throw new Error('A sun study is already being made.');
  working = true;
  const place = projectPlace(doc);
  const D = (Array.isArray(dates) && dates.length ? dates : STUDY_DATES).slice(0, 3);
  const T = (Array.isArray(times) && times.length ? times : STUDY_TIMES).slice(0, 3);
  const total = D.length * T.length;
  const was = { sun: scene.sun(), shadows: scene.shadows(), style: scene.style ? scene.style() : 'model' };
  const panels = [];
  let restore = null, hooked = false, unground = null;
  const north = northOnScreen(scene);
  try {
    if (was.style === 'diagram' && scene.setStyle) scene.setStyle('model');   // the Diagram style draws no shadows
    scene.setShadows(true);
    hooked = true;
    runHooks(hooks, true);
    unground = lightGround(scene);
    restore = scene.prepareCapture({ aiReady: true });   // plain light sky and ground; no grid, figure, overlay or site marks
    const canvas = scene.renderer.domElement;
    const scale = Math.max(0.2, Math.min(3, CELL_W / Math.max(1, canvas.width)));
    let n = 0;
    for (const md of D) {
      for (const hm of T) {
        const iso = isoOf(md);
        const s = sunPosFor({ lat: place.lat, lon: place.lon, date: iso, time: hm, tz });
        const label = `${fmtDate(iso)} · ${fmtTime(minutesOf(hm), true)}`;
        let bmp = null;
        if (s.up) {
          scene.setSun({ az: s.az, alt: Math.max(s.alt, 3) });
          scene.renderNow();                   // moves the light and its shadow camera (syncAuto -> updateSun)
          const blob = await captureView({ renderer: scene.renderer, scene: scene.scene, camera: scene.camera(), scale });
          bmp = await toBitmap(blob);
        }
        panels.push({ label, sun: s, bmp });
        n++;
        if (typeof onProgress === 'function') { try { onProgress(n, total, label); } catch (e) { /* ignore */ } }
      }
    }
  } finally {
    if (restore) { try { restore(); } catch (e) { console.error(e); } }
    if (unground) { try { unground(); } catch (e) { console.error(e); } }
    if (hooked) runHooks(hooks, false);
    try {
      scene.setSun(was.sun);
      scene.setShadows(was.shadows);
      if (was.style === 'diagram' && scene.setStyle) scene.setStyle('diagram');
      scene.requestRender();
    } catch (e) { console.error(e); }
    working = false;
  }

  /* ---- compose ---- */
  const first = panels.find((p) => p.bmp);
  const ratio = first ? first.bmp.height / first.bmp.width : (scene.renderer.domElement.height / Math.max(1, scene.renderer.domElement.width)) || 0.625;
  const cellH = Math.round(CELL_W * ratio);
  const cols = T.length, rows = D.length;
  const sheet = document.createElement('canvas');
  sheet.width = LAY.margin * 2 + cols * CELL_W + (cols - 1) * LAY.gap;
  sheet.height = LAY.margin + LAY.head + rows * cellH + (rows - 1) * LAY.gap + LAY.foot;
  const c = sheet.getContext('2d');
  if (!c) throw new Error('Could not create a 2D canvas for the sheet.');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, sheet.width, sheet.height);
  c.textBaseline = 'alphabetic';

  // title row: project title, place, "Shadow study", date made, CMRLM
  const name = String(title || (doc && doc.name) || 'Untitled').trim();
  const x0 = LAY.margin, y0 = LAY.margin;
  c.textAlign = 'left';
  c.fillStyle = INK; c.font = font(700, 54); c.fillText(name, x0, y0 + 52);
  c.fillStyle = INK2; c.font = font(500, 28);
  const coords = coordText(place.lat, place.lon);
  c.fillText(place.label === coords ? coords : `${place.label}   ${coords}`, x0, y0 + 100);
  c.font = font(400, 24);
  c.fillText(`Shadow study   ${D.map((d) => fmtDate(d)).join(', ')}   at ${T.map((t) => fmtTime(minutesOf(t), true)).join(', ')} local time (${tzText(tz)})   Made ${fmtDate(todayIso())}, ${new Date().getFullYear()}`, x0, y0 + 142);
  c.textAlign = 'right'; c.fillStyle = INK; c.font = font(800, 40);
  c.fillText('CMRLM', sheet.width - LAY.margin, y0 + 50);
  if (north) drawNorth(c, sheet.width - LAY.margin - 60, y0 + 100, north);
  c.strokeStyle = LINE; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x0, y0 + LAY.head - 24); c.lineTo(sheet.width - LAY.margin, y0 + LAY.head - 24); c.stroke();

  // the nine cells
  panels.forEach((p, i) => {
    const r = Math.floor(i / cols), col = i % cols;
    const x = LAY.margin + col * (CELL_W + LAY.gap), y = LAY.margin + LAY.head + r * (cellH + LAY.gap);
    if (p.bmp) {
      c.drawImage(p.bmp, x, y, CELL_W, cellH);
      if (p.bmp.close) p.bmp.close();
    } else {
      c.fillStyle = '#e6e8eb'; c.fillRect(x, y, CELL_W, cellH);
      c.fillStyle = INK2; c.font = font(500, 30); c.textAlign = 'center';
      c.fillText('Sun below the horizon', x + CELL_W / 2, y + cellH / 2 + 10);
    }
    c.strokeStyle = LINE; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, CELL_W - 2, cellH - 2);
    // label pill
    c.textAlign = 'left';
    c.font = font(700, 30);
    const sub = p.sun.up ? `Sun ${Math.round(p.sun.az)}° az, ${Math.round(p.sun.alt)}° alt` : '';
    const w1 = c.measureText(p.label).width;
    c.font = font(400, 20);
    const w2 = sub ? c.measureText(sub).width : 0;
    const pw = Math.max(w1, w2) + 32, ph = sub ? 82 : 52;
    c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillRect(x + 14, y + 14, pw, ph);
    c.fillStyle = INK; c.font = font(700, 30); c.fillText(p.label, x + 30, y + 52);
    if (sub) { c.fillStyle = INK2; c.font = font(400, 20); c.fillText(sub, x + 30, y + 82); }
  });

  // footer
  const fy = sheet.height - LAY.foot / 2 + 6;
  c.textAlign = 'left'; c.fillStyle = INK2; c.font = font(400, 20);
  c.fillText('Shadows from the real sun at each date and time (NOAA solar position). Same camera in every view.', LAY.margin, fy);

  return await new Promise((resolve, reject) => sheet.toBlob((b) => (b ? resolve(b) : reject(new Error('The sheet could not be saved as a PNG.'))), 'image/png'));
}

/** True while a sheet is being made. */
export const sunStudyBusy = () => working;

/* ---------------------------------------------------------------- View panel controls */

const viewSun = (ctx) => { try { return (ctx.view.get() || {}).sun || {}; } catch (e) { return {}; } };
const docOf = (ctx) => { try { return ctx.project && ctx.project.doc ? ctx.project.doc() : null; } catch (e) { return null; } };
const realOf = (ctx, sun) => {
  const s = sun || viewSun(ctx);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || '')) ? s.date : todayIso();
  const time = fin(minutesOf(s.time)) ? s.time : '12:00';
  const tz = s.tz || DEFAULT_TZ;
  return { date, time, tz };
};
/** az and alt for the view (alt kept at 3 degrees or more, as the scene does). */
const viewPos = (ctx, date, time, tz) => {
  const P = projectPlace(docOf(ctx));
  const s = sunPosFor({ lat: P.lat, lon: P.lon, date, time, tz });
  return { az: r1(s.az), alt: r1(Math.max(s.alt, 3)), up: s.up, raw: s };
};

/** Recomputes the view sun when Real sun is on (call it after a project opens: the place may have changed). */
export function applyRealSun(ctx) {
  const s = viewSun(ctx);
  if (s.mode !== 'real') return false;
  const { date, time, tz } = realOf(ctx, s);
  const p = viewPos(ctx, date, time, tz);
  if (Math.abs((s.az ?? -999) - p.az) < 0.05 && Math.abs((s.alt ?? -999) - p.alt) < 0.05) return false;
  ctx.view.set({ sun: { mode: 'real', date, time, az: p.az, alt: p.alt } });
  return true;
}

/** The extra Sun controls for the View panel (the azimuth and altitude sliders stay in the panel). */
export function sunStudyControls(ctx) {
  const { h, Toast } = ctx.ui;
  const C = ctx.ui.Controls;
  const isReal = () => viewSun(ctx).mode === 'real';
  const wrap = h('div', { class: 'sun-study' });

  const modeCtl = C.segmented({
    label: 'Sun',
    bind: {
      get: () => (isReal() ? 'real' : 'manual'),
      set: (v) => {
        if (v === 'real') {
          const { date, time } = realOf(ctx);
          const p = viewPos(ctx, date, time);
          ctx.view.set({ sun: { mode: 'real', date, time, az: p.az, alt: p.alt } });
        } else ctx.view.set({ sun: { mode: 'manual' } });
      },
      commit: () => {},
    },
    options: [{ value: 'manual', label: 'Manual' }, { value: 'real', label: 'Real sun' }],
  });

  // date
  const dateId = `sun-date-${Math.random().toString(36).slice(2, 7)}`;
  const dateIn = h('input', { class: 'textfield', type: 'date', id: dateId, 'aria-label': 'Sun study date' });
  dateIn.value = realOf(ctx).date;
  dateIn.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIn.value)) return;
    const { time } = realOf(ctx);
    const p = viewPos(ctx, dateIn.value, time);
    ctx.view.set({ sun: { mode: 'real', date: dateIn.value, time, az: p.az, alt: p.alt } });
  });
  const dateRow = h('div', { class: 'field-row' }, h('label', { class: 'field-label', for: dateId }, 'Date'), dateIn);

  // readout: place and sun
  const placeLine = h('p', { class: 'help sun-place' });
  const sunLine = h('p', { class: 'help sun-pos' });
  const showReadout = (date, time) => {
    const P = projectPlace(docOf(ctx));
    placeLine.textContent = `Place: ${P.label}. Time: ${tzText(DEFAULT_TZ)}.`;
    const p = viewPos(ctx, date, time);
    sunLine.textContent = p.up ? `Sun azimuth ${Math.round(p.raw.az)}°, altitude ${Math.round(p.raw.alt)}°.` : 'Sun below the horizon.';
  };

  // time: 5:00 AM to 9:00 PM in 15 minute steps. While the slider moves the scene sun follows directly; the view saves on release
  // (a view change rebuilds this panel, which would end the drag).
  let liveMin = null;
  const timeCtl = C.slider({
    label: 'Time',
    min: 300, max: 1260, step: 15, hardMin: 0, hardMax: 1425,
    format: (v) => fmtTime(v),
    parse: (t) => {
      const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(t || ''));
      if (!m) return NaN;
      let hh = +m[1] % 24; const mm = +(m[2] || 0);
      if (m[3]) { hh %= 12; if (/p/i.test(m[3])) hh += 12; }
      return Math.round((hh * 60 + mm) / 15) * 15;
    },
    bind: {
      get: () => (liveMin !== null ? liveMin : minutesOf(realOf(ctx).time)),
      set: (v, live) => {
        const { date } = realOf(ctx);
        const time = hmOf(v);
        const p = viewPos(ctx, date, time);
        if (live) {
          liveMin = v;
          try { ctx.scene.setSun({ az: p.az, alt: p.alt }); } catch (e) { /* no scene */ }
          showReadout(date, time);
        } else {
          liveMin = null;
          ctx.view.set({ sun: { mode: 'real', date, time, az: p.az, alt: p.alt } });
        }
      },
      commit: () => {
        if (liveMin === null) return;
        const v = liveMin;
        liveMin = null;
        const { date } = realOf(ctx);
        const time = hmOf(v);
        const p = viewPos(ctx, date, time);
        ctx.view.set({ sun: { mode: 'real', date, time, az: p.az, alt: p.alt } });
      },
    },
  });

  const realBlock = C.when(isReal, [dateRow, timeCtl, placeLine, sunLine]);
  { const r = realOf(ctx); showReadout(r.date, r.time); }

  // the sheet
  const btn = h('button', { class: 'btn outline', type: 'button', title: 'One image with 9 views: March 21, June 21 and December 21 at 9 AM, 12 PM and 3 PM.' }, 'Create sun study');
  btn.addEventListener('click', async () => {
    if (working) return;
    const doc = docOf(ctx);
    const title = (doc && doc.name) || 'CMRLM';
    btn.disabled = true;
    const note = Toast.show('Making the sun study…', { ms: 0 });
    try {
      const hooks = ctx.layers && ctx.layers.setAiReady ? [(on) => ctx.layers.setAiReady(on)] : [];
      const blob = await createSunStudy(ctx.scene, { doc, title, hooks });
      if (note) note.remove();
      const how = await ctx.capture.deliver(blob, `${title} sun study`);
      if (how !== 'cancelled') Toast.show('Sun study saved.', { kind: 'good' });
    } catch (e) {
      console.error(e);
      if (note) note.remove();
      Toast.show(`The sun study could not be made. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  wrap.append(modeCtl.el, realBlock.el, h('div', { class: 'btn-row' }, btn));
  return wrap;
}
