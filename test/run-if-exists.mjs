// Runs each test file given on the command line with node, one after another, and skips a file that does not exist
// yet (a later build phase writes it). Exits with the first failing test's code.
// Usage: node test/run-if-exists.mjs test/a.test.mjs test/b.test.mjs
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

for (const file of process.argv.slice(2)) {
  if (!existsSync(resolve(file))) {
    console.log(`skip ${file} (not written yet)`);
    continue;
  }
  const r = spawnSync(process.execPath, [file], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
}
