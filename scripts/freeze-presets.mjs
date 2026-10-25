// Freezes the units of the Plate Planner presets 8.1 to 8.6 (docs/plate-planner-draw-plan.md section 6).
// Each preset runs once through the automatic fill (fillPlates, the engine the suggestions use); its units become the
// drawn units of the preset, so the section 8 numbers stay. The fill reads locks only, never the drawn units, so a run
// on presets that already carry frozen units gives the same output.
//
// Run: node scripts/freeze-presets.mjs            prints the FROZEN block
//      node scripts/freeze-presets.mjs --write    also replaces the block in src/plate/presets.js
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { fillPlates } = await import("../src/plate/fill.js");
const { PRESETS } = await import("../src/plate/presets.js");

export const FROZEN_IDS = ["double-loaded-bar", "hotel-bar", "l-plate-60-ft-arms", "u-plate-60-ft-arms", "point-tower", "courtyard-typed-o"];
const BEGIN = "// BEGIN FROZEN UNITS";
const END = "// END FROZEN UNITS";

const r1 = (v) => Math.round(v * 10) / 10;
const pad2 = (n) => String(n).padStart(2, "0");
const num = (v) => { const r = Math.round(v * 1000) / 1000; return String(r === 0 ? 0 : r); };
const ring = (r) => `[${r.map((p) => `[${num(p[0])}, ${num(p[1])}]`).join(", ")}]`;

function frozenUnits(state) {
  const built = fillPlates(JSON.parse(JSON.stringify(state)), { project: null });
  const f = built.groups[0].fill;
  return f.units.map((u, k) => {
    const run = u.runId ? f.runs.find((r) => r.id === u.runId) : null;
    return {
      id: `U-${pad2(k + 1)}`, type: u.type, mode: u.wrap ? "corner" : run ? "run" : "free",
      runKey: run ? `${run.ring}:${run.edge}:${r1(run.from)}` : null, outer: u.outer,
      ...(u.type === "accessible" ? { accessible: true } : {}),
    };
  });
}

const lines = [BEGIN + " (scripts/freeze-presets.mjs; do not edit by hand)", "const FROZEN = {"];
for (const id of FROZEN_IDS) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`freeze-presets: missing preset "${id}".`);
  lines.push(`  '${id}': [`);
  for (const u of frozenUnits(p.state)) {
    lines.push(`    { id: '${u.id}', type: '${u.type}', mode: '${u.mode}', runKey: ${u.runKey === null ? "null" : `'${u.runKey}'`}, ${u.accessible ? "accessible: true, " : ""}outer: ${ring(u.outer)} },`);
  }
  lines.push("  ],");
}
lines.push("};", END);
const block = lines.join("\n");
console.log(block);

if (process.argv.includes("--write")) {
  const file = new URL("../src/plate/presets.js", import.meta.url);
  const src = readFileSync(file, "utf8");
  const i = src.indexOf(BEGIN), j = src.indexOf(END);
  if (i < 0 || j < i) throw new Error("freeze-presets: presets.js has no FROZEN block markers.");
  writeFileSync(file, src.slice(0, i) + block + src.slice(j + END.length));
  console.error("freeze-presets: wrote src/plate/presets.js");
}
