// Node check for the first-visit tour pictures in assets/tour/. Run: node test/tour.assets.test.mjs
// Each picture must exist, be a JPEG, be under 300 KB, and be 1200 px wide (read from the JPEG header; no image library).
// When index.html lists slide pictures (img: "assets/tour/..."), each one must be one of the files checked here.
// Make the pictures with: npm run shots:tour
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["01-workspace.jpg", "02-pipeline.jpg", "03-tower-on-site.jpg", "04-plate-fill.jpg", "05-grading.jpg"];
const MAX_BYTES = 300 * 1024, WIDTH = 1200;

/** { width, height } from the first SOFn marker of a JPEG, or null when the bytes are not a JPEG. */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }                                  // fill byte
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }  // markers without a length
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error("FAIL  " + name + ": " + e.message); } };

for (const f of FILES) {
  const file = path.join(ROOT, "assets", "tour", f);
  check(f + " exists", () => { if (!existsSync(file)) throw new Error("missing; run npm run shots:tour"); });
  if (!existsSync(file)) continue;
  const buf = readFileSync(file);
  check(f + " is a JPEG", () => { if (!jpegSize(buf)) throw new Error("not a JPEG (no SOI or SOF marker)"); });
  check(f + " is under 300 KB", () => { if (statSync(file).size > MAX_BYTES) throw new Error(statSync(file).size + " bytes"); });
  check(f + " is 1200 px wide", () => { const s = jpegSize(buf); if (!s || s.width !== WIDTH) throw new Error("width " + (s && s.width)); });
}

check("every slide picture in index.html is one of the five files", () => {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const found = [...html.matchAll(/img:\s*["'](assets\/tour\/[^"']+)["']/g)].map((m) => m[1]);
  for (const p of found) {
    if (!FILES.includes(path.basename(p))) throw new Error(p + " is not one of " + FILES.join(", "));
    if (!existsSync(path.join(ROOT, p))) throw new Error(p + " does not exist");
  }
});

console.log(`tour assets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
