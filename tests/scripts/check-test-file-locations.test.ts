/**
 * Tests for scripts/check-test-file-locations.mjs
 *
 * Strategy: spawn the script as a child process against a temporary
 * directory tree so we can verify exit codes without touching the real repo.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPT = resolve(__dirname, "../../scripts/check-test-file-locations.mjs");

/** Run the script with a custom CWD and return { exitCode, stdout, stderr } */
function runScript(cwd: string) {
  const result = spawnSync("node", [SCRIPT], {
    cwd,
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Create a minimal repo tree rooted at `base`. */
function scaffold(base: string, paths: string[]) {
  for (const p of paths) {
    const full = join(base, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// placeholder\n");
  }
}

describe("check-test-file-locations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sorokeep-guard-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path: all test files are under tests/
  // -------------------------------------------------------------------------

  it("exits 0 when there are no test files at all", () => {
    scaffold(tmpDir, ["src/foo.ts", "src/bar.ts"]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).toBe(0);
  });

  it("exits 0 when all *.test.ts files are inside tests/", () => {
    scaffold(tmpDir, [
      "src/alerts/dispatcher.ts",
      "tests/alerts/dispatcher.test.ts",
      "tests/core/monitor.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).toBe(0);
  });

  it("exits 0 when test files are nested deeply inside tests/", () => {
    scaffold(tmpDir, [
      "tests/a/b/c/deep.test.ts",
      "tests/lib.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Failure path: misplaced test files outside tests/
  // -------------------------------------------------------------------------

  it("exits non-zero when a *.test.ts file is directly in src/", () => {
    scaffold(tmpDir, [
      "src/foo.test.ts",
      "tests/bar.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).not.toBe(0);
  });

  it("exits non-zero when a *.test.ts file is in a src/ subdirectory", () => {
    scaffold(tmpDir, ["src/alerts/webhook.test.ts"]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).not.toBe(0);
  });

  it("exits non-zero when multiple misplaced test files exist", () => {
    scaffold(tmpDir, [
      "src/alerts/telegram.test.ts",
      "src/alerts/discord.test.ts",
      "src/alerts/pagerduty.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).not.toBe(0);
  });

  it("exits non-zero when a test file is at the repo root", () => {
    scaffold(tmpDir, ["something.test.ts"]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).not.toBe(0);
  });

  it("exits non-zero when a test file is under action/", () => {
    scaffold(tmpDir, ["action/run.test.ts"]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).not.toBe(0);
  });

  // -------------------------------------------------------------------------
  // Exclusions: node_modules and dist must be ignored
  // -------------------------------------------------------------------------

  it("exits 0 and ignores test files inside node_modules/", () => {
    scaffold(tmpDir, [
      "node_modules/some-pkg/helper.test.ts",
      "tests/mytest.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).toBe(0);
  });

  it("exits 0 and ignores test files inside dist/", () => {
    scaffold(tmpDir, [
      "dist/compiled.test.ts",
      "tests/mytest.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).toBe(0);
  });

  it("exits 0 and ignores test files inside .npm-cache/", () => {
    scaffold(tmpDir, [
      ".npm-cache/pkg/something.test.ts",
    ]);
    const { exitCode } = runScript(tmpDir);
    expect(exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Output: the script must report offending paths on failure
  // -------------------------------------------------------------------------

  it("prints the offending file path to stdout or stderr on failure", () => {
    scaffold(tmpDir, ["src/alerts/webhook.test.ts"]);
    const { stdout, stderr } = runScript(tmpDir);
    const combined = stdout + stderr;
    expect(combined).toMatch(/src\/alerts\/webhook\.test\.ts/);
  });

  it("prints a success message on exit 0", () => {
    scaffold(tmpDir, ["tests/mytest.test.ts"]);
    const { stdout, stderr } = runScript(tmpDir);
    const combined = stdout + stderr;
    // should emit at least one non-empty line
    expect(combined.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Real-repo integration: current state of this repository
  // -------------------------------------------------------------------------

  it("exits 0 on the actual repo, which has no test files outside tests/", () => {
    const repoRoot = resolve(__dirname, "../..");
    const { exitCode } = runScript(repoRoot);
    expect(exitCode).toBe(0);
  });
});
