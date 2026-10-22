// Every test case in src/plate/testcases.js through the real fill and metrics (plan section 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");
const { TEST_CASES } = await import("../src/plate/testcases.js");
const { buildPlates } = await import("../src/plate/fill.js");
const { computeMetrics } = await import("../src/plate/metrics.js");

for (const tc of TEST_CASES) {
  test(`case ${tc.id || tc.name}`, () => {
    const built = buildPlates(tc.state, { project: null });
    const m = computeMetrics(tc.state, built);
    const row = m.groups[0].row;
    const e = tc.expect || {};
    if (e.units != null) assert.equal(row.units, e.units, "units");
    if (e.nrsf != null) assert.ok(Math.abs(row.nrsf - e.nrsf) <= (e.tolerance ?? 0.5), `nrsf ${row.nrsf} vs ${e.nrsf}`);
    if (e.counts) {
      const got = {};
      for (const [k, v] of Object.entries(row.byType || {})) got[k] = typeof v === "object" ? (v.placed ?? v.count) : v;
      for (const [k, v] of Object.entries(e.counts)) assert.equal(got[k] ?? 0, v, `count ${k}: ${JSON.stringify(row.byType)}`);
    }
  });
}
