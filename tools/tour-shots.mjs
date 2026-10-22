// Makes the five pictures for the first-visit tour: assets/tour/*.jpg (1200 x 750, JPEG, under 300 KB each).
// Run: npm run shots:tour   (needs `npm install` and, once, `npx playwright install chromium`).
// In the build container: NODE_PATH=/home/claude/.npm-global/lib/node_modules node tools/tour-shots.mjs
// Plan: docs/first-visit-tour-technical-plan.md section 5. Safe to run again: it rewrites the same five files.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "tour");
const require = createRequire(import.meta.url);      // honors NODE_PATH, unlike a bare ESM import
const nm = (...p) => path.join(ROOT, "node_modules", ...p);
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const VIEW = { width: 1440, height: 900 };
const OUT_W = 1200, OUT_H = 750, MAX_BYTES = 300 * 1024;
const TOWER_PRESET = process.env.TOUR_PRESET || "point-tower";   // the plan's massing; TOUR_PRESET=<tower preset id> tries another
const TOOLS = ["site", "tower", "midrise", "plate", "parking", "facade", "grading"];

/* ---------- 1. the fixture project: a Site Model section plus a point-tower massing ---------- */

async function buildProject() {
  globalThis.ClipperLib = require(nm("clipper-lib"));
  const { makeFrame } = await imp("src/site/geo.js");
  const M = await imp("src/site/model.js");
  const D = await imp("src/site/derived.js");
  const PJ = await imp("src/shared/project.js");
  const SL = await imp("src/shared/sitelayer.js");
  const TP = await imp("src/tower/presets.js");
  const TG = await imp("src/tower/geometry.js");
  const TD = await imp("src/tower/derived.js");

  const LAT = 33.927, LON = -84.339, SIZE = 600;      // Ravinia, Dunwoody; 600 ft square, origin at the SW corner
  const frame = makeFrame(LAT, LON, SIZE);
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const feat = (id, type, properties, parts) => ({ id, type, properties, parts });
  const P = (outer, holes = []) => ({ outer, holes });
  function makeDem(fr, zOf, { w = 120, h = 120, margin = 60 } = {}) {
    const bb = fr.bbox(margin), pixelW = (bb.east - bb.west) / w, pixelH = (bb.north - bb.south) / h;
    const data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const [x, y] = fr.toLocal(bb.west + (c + 0.5) * pixelW, bb.north - (r + 0.5) * pixelH);
      data[r * w + c] = zOf(x, y) * 0.3048;            // feet to meters, like a real DEM
    }
    return { width: w, height: h, data, west: bb.west, north: bb.north, pixelW, pixelH };
  }
  // Tilted ground with a bump; 25 buildings (one slot left open for the tower), two roads, a pond, 30 trees.
  const ground = M.buildGround(frame, makeDem(frame, (x, y) => 1000 + 0.04 * x + 0.02 * y + 6 * Math.sin(x / 90)));
  const buildings = []; let k = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    if (i === 2 && j === 2) continue;
    const x = 40 + i * 115, y = 40 + j * 115;
    buildings.push(feat("b" + (k++), 3, { height: 20 + ((i * 3 + j) % 5) * 12 }, [P(rect(x, y, x + 70, y + 60))]));
  }
  buildings.push(feat("court", 3, { num_floors: 4 }, [P(rect(380, 380, 520, 520), [rect(420, 420, 480, 480).reverse()])]));
  const features = {
    building: buildings,
    segment: [
      feat("r1", 2, { subtype: "road", class: "primary", "@name": "Main St" }, [[[0, 290], [600, 300]]]),
      feat("r2", 2, { subtype: "road", class: "residential" }, [[[300, 0], [300, 600]]]),
    ],
    land: Array.from({ length: 30 }, (_, i) => feat("t" + i, 1, { class: "tree" }, [[30 + (i * 97) % 560, 30 + (i * 53) % 560]])),
    water: [feat("p1", 3, { class: "pond" }, [P(rect(460, 60, 560, 140))])],
  };
  const model = {
    frame, ground,
    buildings: M.buildBuildings(features, frame, ground),
    roads: M.buildRoads(features, frame, ground, { walks: false }),
    trees: M.buildTrees(features, frame, ground),
    water: M.buildWater(features, frame, ground),
  };
  const siteState = { query: "Ravinia, Dunwoody, GA", lat: LAT, lon: LON, size: SIZE, release: "2026-09-24.0", walks: false };
  const siteDerived = D.siteDerived(model, { address: "Ravinia, Dunwoody, GA", lat: LAT, lon: LON, size: SIZE, release: "2026-09-24.0", walks: false });

  let doc = PJ.newProject({ name: "Ravinia tower", frame: { kind: "site", lat: LAT, lon: LON, size: SIZE } });
  doc.id = "tourdemo0001";                              // fixed id and dates, so a rerun gives the same pictures
  doc.createdAt = doc.updatedAt = "2026-10-20T14:00:00.000Z";
  doc = PJ.writeSection(doc, "site", { tool: "site", schema: 1, state: siteState, derived: siteDerived });

  // Tower massing at the site center, standing on the ground there.
  const st = JSON.parse(JSON.stringify(TP.PRESETS.find((p) => p.id === TOWER_PRESET).state));
  const built = TG.buildPlates(st);
  const met = TG.computeMetrics(st, built.plates);
  const der = TD.towerDerived(st, built, met);
  const cz = SL.groundZAt(siteDerived, SIZE / 2, SIZE / 2);
  const baseZ = Number.isFinite(cz) ? Math.round(cz * 100) / 100 : 0;
  doc = PJ.writeSection(doc, "massing", {
    tool: "tower", schema: 1, placement: { x: SIZE / 2, y: SIZE / 2, rotation: 0, baseZ }, state: st, derived: der,
  });
  const T = ["2026-10-20T14:00:00.000Z", "2026-10-20T14:30:00.000Z"];   // site, then massing
  doc.updatedAt = T[1];
  doc.sections.site.updatedAt = T[0]; doc.sections.massing.updatedAt = T[1];
  doc.log.forEach((e, i) => { e.at = T[Math.min(i, 1)]; });
  const v = PJ.validate(doc);
  if (!v.ok) throw new Error("fixture project is not valid: " + v.errors.join("; "));
  return doc;
}

/* ---------- 2. static server (repo root) and the CDN routes ---------- */

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let f = path.normalize(path.join(ROOT, p));
      if (f !== ROOT && !f.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!fs.existsSync(f)) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function routeCdn(context) {
  await context.route(/cdn\.jsdelivr\.net/, (r) => {
    const u = new URL(r.request().url()); let m, f = null;
    if ((m = u.pathname.match(/^\/npm\/three@0\.170\.0\/(.*)$/))) f = nm("three", m[1]);
    else if ((m = u.pathname.match(/^\/npm\/clipper-lib@6\.4\.2\/(.*)$/))) f = nm("clipper-lib", m[1]);
    if (f && fs.existsSync(f)) r.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(f) });
    else r.abort();
  });
}

/* ---------- 3. shooting ---------- */

const SHOTS = [
  { file: "01-workspace.jpg", kind: "workspace" },
  { file: "02-pipeline.jpg", kind: "pipeline" },
  { file: "03-tower-on-site.jpg", kind: "tool", dir: "tower", hook: "__tower", settle: 2500 },
  { file: "04-plate-fill.jpg", kind: "tool", dir: "plate", hook: "__plate", settle: 2500, noProject: true, view: "plan" },   // the default double-loaded bar: a clean fill
  { file: "05-grading.jpg", kind: "tool", dir: "grading", hook: "__grading", settle: 4000 },
];

async function toJpeg(png, file) {
  const sharp = require("sharp");
  let q = 82, buf;
  for (;;) {
    const opts = { quality: q, progressive: true, mozjpeg: true };
    buf = await sharp(png).resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" }).jpeg(opts).toBuffer();
    if (buf.length <= MAX_BYTES || q <= 78) break;
    q = 78;
  }
  fs.writeFileSync(file, buf);
  return { bytes: buf.length, quality: q };
}

async function main() {
  const { chromium } = require("playwright");
  const doc = await buildProject();
  const dump = process.argv.find((a) => a.startsWith("--save-fixture="));   // debugging: write the fixture project and stop
  if (dump) { fs.writeFileSync(dump.split("=")[1], JSON.stringify(doc)); return; }
  const { server, port } = await startServer();
  const base = "http://127.0.0.1:" + port;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [], problems = [];
  try {
    // A fresh context per picture: empty storage, then exactly the keys below.
    const seed = {
      "cmrlm.project.index": JSON.stringify([{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, bytes: JSON.stringify(doc).length }]),
      ["cmrlm.project." + doc.id]: JSON.stringify(doc),
      "cmrlm.project.last": doc.id,
      "cmrlm.workspace.howto": "closed",
      "cmrlm.tour.v1": "seen",
      ...Object.fromEntries(TOOLS.map((t) => ["cmrlm.tip." + t + ".v1", "seen"])),
    };
    for (const shot of SHOTS) {
      const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, reducedMotion: "reduce" });
      await routeCdn(context);
      await context.addInitScript((kv) => { try { if (!sessionStorage.getItem("__seeded")) { for (const k in kv) localStorage.setItem(k, kv[k]); sessionStorage.setItem("__seeded", "1"); } } catch (e) { /* ignore */ } }, seed);
      const page = await context.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      let png;
      if (shot.kind === "tool") {
        await page.goto(`${base}/${shot.dir}/` + (shot.noProject ? "" : `?project=${doc.id}`), { waitUntil: "load" });
        try { await page.waitForFunction((h) => !!window[h], shot.hook, { timeout: 30000 }); }
        catch (e) { problems.push(`${shot.file}: the ${shot.hook} hook did not appear`); }
        if (shot.view) await page.click(`button[data-view="${shot.view}"]`).catch(() => problems.push(`${shot.file}: no ${shot.view} view button`));
        await page.waitForTimeout(shot.settle);
        png = await page.screenshot();
      } else {
        await page.clock.setFixedTime(new Date("2026-10-22T15:00:00Z"));   // the sheet prints today's date; keep the picture the same on any day
        await page.goto(`${base}/index.html`, { waitUntil: "load" });
        await page.waitForSelector("#list tr", { timeout: 15000 }).catch(() => problems.push(`${shot.file}: no project row in the schedule`));
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.waitForTimeout(600);
        if (shot.kind === "workspace") {
          png = await page.screenshot();
        } else {
          // The Tools list: scroll it to the top of the view and clip to the list plus a small margin.
          const box = await page.evaluate(() => {
            const h = [...document.querySelectorAll("h2.dtt")].find((e) => e.textContent.trim() === "Tools");
            const sec = h && h.closest("section");
            if (!sec) return null;
            sec.scrollIntoView({ block: "start" });
            const r = sec.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          });
          await page.waitForTimeout(300);
          if (!box) { problems.push(`${shot.file}: the Tools list was not found; shot the full view`); png = await page.screenshot(); }
          else {
            // Fit a 1200 x 750 (8:5) window around the list: full width of the page column, 8:5 tall, anchored at the list top.
            const pad = 16, w = Math.min(VIEW.width, box.w + 2 * pad), h = Math.min(VIEW.height, w * OUT_H / OUT_W);
            const x = Math.max(0, Math.min(VIEW.width - w, box.x - pad + (box.w + 2 * pad - w) / 2));
            const y = Math.max(0, Math.min(VIEW.height - h, box.y - pad));
            png = await page.screenshot({ clip: { x, y, width: w, height: h } });
          }
        }
      }
      if (errs.length) problems.push(`${shot.file}: page errors: ${errs.slice(0, 2).join(" | ")}`);
      const r = await toJpeg(png, path.join(OUT, shot.file));
      console.log(`${shot.file}  ${OUT_W}x${OUT_H}  ${r.bytes} bytes (${(r.bytes / 1024).toFixed(0)} KB, q${r.quality})`);
      if (r.bytes > MAX_BYTES) failures.push(`${shot.file} is ${r.bytes} bytes, over ${MAX_BYTES}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const p of problems) console.warn("WARN  " + p);
  if (failures.length) { for (const f of failures) console.error("FAIL  " + f); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
