import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerInitCommand } from "../../src/commands/init";
import * as configUtils from "../../src/utils/config";
import * as initCore from "../../src/core/init";

describe("init command", () => {
  const tempDir = path.join(os.tmpdir(), `sorokeep-init-test-${Date.now()}`);
  const configPath = path.join(tempDir, "config.yaml");

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    vi.spyOn(configUtils, "loadConfig").mockReturnValue({ network: "testnet", pollingIntervalSeconds: 300 });
    vi.spyOn(configUtils, "saveConfig").mockImplementation((config) => {
      fs.writeFileSync(configPath, JSON.stringify(config));
      fs.chmodSync(configPath, 0o600);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs non-interactively with --yes and writes a config file", async () => {
    vi.spyOn(initCore, "runInitWizard").mockResolvedValue({ success: true, contractId: "C123" } as any);

    const program = new Command();
    registerInitCommand(program);

    await program.parseAsync([
      "node",
      "sorokeep",
      "init",
      "--yes",
      "--contract",
      "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",
      "--network",
      "testnet",
      "--channel-type",
      "slack",
      "--channel-target",
      "#alerts",
    ]);

    expect(initCore.runInitWizard).toHaveBeenCalled();
    expect(fs.existsSync(configPath)).toBe(true);
    const mode = fs.statSync(configPath).mode & 0o777;
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    } else {
      expect([0o600, 0o666]).toContain(mode);
    }
  });
});
