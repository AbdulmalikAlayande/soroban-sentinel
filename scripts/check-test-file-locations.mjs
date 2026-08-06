#!/usr/bin/env node
/**
 * check-test-file-locations.mjs
 *
 * Guard script that ensures every *.test.ts file in the repository lives
 * under the tests/ directory. This prevents test files silently placed
 * elsewhere from being excluded by vitest's include: ["tests/**\/*.test.ts"]
 * glob and going unexecuted.
 *
 * Exits 0  — no misplaced test files found.
 * Exits 1  — one or more *.test.ts files found outside tests/.
 *
 * Usage:
 *   node scripts/check-test-file-locations.mjs
 *   npm run check:test-locations
 */

import { globSync } from "node:fs";
import { relative, sep } from "node:path";

// Directories to skip entirely.
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".npm-cache"]);

/**
 * Return true if any path segment of `relPath` is in EXCLUDED_DIRS.
 * relPath uses the OS separator.
 */
function isExcluded(relPath) {
  return relPath.split(sep).some((segment) => EXCLUDED_DIRS.has(segment));
}

const cwd = process.cwd();

// Glob every *.test.ts in the repo tree.
const allTestFiles = globSync("**/*.test.ts", {
  cwd,
  nodir: true,
});

// Partition into good (inside tests/) and bad (everything else).
const misplaced = [];

for (const file of allTestFiles) {
  const rel = relative(cwd, file); // already relative when coming from globSync with cwd
  // globSync with cwd returns paths relative to cwd already
  const normalised = rel.split("/").join(sep); // normalise slashes on Windows

  if (isExcluded(normalised)) {
    continue;
  }

  // A correctly-placed file starts with "tests" followed by the separator.
  const firstSegment = normalised.split(sep)[0];
  if (firstSegment !== "tests") {
    // Report with forward slashes regardless of OS, so output is deterministic.
    misplaced.push(normalised.split(sep).join("/"));
  }
}

if (misplaced.length === 0) {
  console.log("✔ All test files are correctly located under tests/");
  process.exit(0);
} else {
  console.error(
    `✖ Found ${misplaced.length} test file${misplaced.length === 1 ? "" : "s"} outside tests/:\n`
  );
  for (const f of misplaced) {
    console.error(`  ${f}`);
  }
  console.error(
    "\nMove these files into the tests/ directory tree to match vitest's include glob."
  );
  process.exit(1);
}
