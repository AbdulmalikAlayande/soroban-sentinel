import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildManPage, renderManPage } from "../../scripts/generate-man.ts";

describe("CLI man page generation", () => {
  it("includes every top-level command and its description", () => {
    const page = buildManPage();

    const expectedCommands = [
      ["alerts", "Manage alert configurations"],
      ["budget", "Manage monthly spending bounds for contracts"],
      ["channels", "Manage channel accounts for fee bumping and transaction parallelism"],
      ["check", "Check TTL health for a watched contract (CI-friendly, can be forced)"],
      ["completion", "Generate or query shell completion suggestions"],
      ["costs", "Show rent costs and extension history for a contract"],
      ["daemon", "Start the monitoring daemon — polls contracts at a fixed interval"],
      ["db", "Backup, restore, and maintain database state"],
      ["guard", "Configure auto-extension policy for a contract"],
      ["history", "Show state change history for a contract"],
      ["inspect", "Inspect contract storage and token balances"],
      ["mcp", "Start the Model Context Protocol (MCP) server on stdio transport"],
      ["pause", "Temporarily pause daemon polling and alerting for a contract"],
      ["resources", "Show historical resource usage trends for a contract"],
      ["restore", "Restore archived entries for a contract"],
      ["resume", "Resume daemon polling and alerting for a paused contract"],
      ["status", "Show TTL and storage health for a watched contract"],
      ["watch", "Register and start watching a contract"],
    ];

    for (const [command, description] of expectedCommands) {
      expect(page).toContain(`.SH ${command.toUpperCase()}`);
      expect(page).toContain(description);
    }
  });

  it("renders the generated man page without troff syntax errors", () => {
    const page = buildManPage();
    const tempDir = mkdtempSync(path.join(tmpdir(), "sorokeep-man-"));
    const filePath = path.join(tempDir, "sorokeep.1");

    try {
      writeFileSync(filePath, page, "utf8");
      const result = renderManPage(filePath);
      expect(result).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
