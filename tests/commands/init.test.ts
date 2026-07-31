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
  const validContract = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    vi.spyOn(configUtils, "loadConfig").mockReturnValue({ network: "testnet", pollingIntervalSeconds: 300 });
    vi.spyOn(configUtils, "saveConfig").mockImplementation((config) => {
      fs.writeFileSync(configPath, JSON.stringify(config));
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

  it("runs non-interactively with --yes and saves the resolved config", async () => {
    vi.spyOn(initCore, "runInitWizard").mockResolvedValue({ success: true, contractId: validContract } as any);

    const program = new Command();
    registerInitCommand(program);

    await program.parseAsync([
      "node",
      "sorokeep",
      "init",
      "--yes",
      "--contract",
      validContract,
      "--network",
      "testnet",
      "--channel-type",
      "slack",
      "--channel-target",
      "#alerts",
    ]);

    expect(initCore.runInitWizard).toHaveBeenCalledWith(expect.objectContaining({
      contractId: validContract,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
    }));
    expect(configUtils.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      network: "testnet",
    }));
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("uses the saved network when --network is not provided", async () => {
    vi.mocked(configUtils.loadConfig).mockReturnValue({ network: "mainnet", pollingIntervalSeconds: 300 });
    vi.spyOn(initCore, "runInitWizard").mockResolvedValue({ success: true, contractId: validContract } as any);

    const program = new Command();
    registerInitCommand(program);

    await program.parseAsync([
      "node",
      "sorokeep",
      "init",
      "--yes",
      "--contract",
      validContract,
      "--channel-type",
      "slack",
      "--channel-target",
      "#alerts",
    ]);

    expect(initCore.runInitWizard).toHaveBeenCalledWith(expect.objectContaining({ network: "mainnet" }));
    expect(configUtils.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ network: "mainnet" }));
  });

  it("exits with an error when --yes is used without the required flags", async () => {
    const program = new Command();
    registerInitCommand(program);

    await program.parseAsync([
      "node",
      "sorokeep",
      "init",
      "--yes",
      "--contract",
      validContract,
    ]);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("required"));
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(configUtils.saveConfig).not.toHaveBeenCalled();
  });

  it("rejects --guard-enabled together with --guard-disabled", async () => {
    const program = new Command();
    registerInitCommand(program);
    program.exitOverride();

    await expect(program.parseAsync([
      "node",
      "sorokeep",
      "init",
      "--guard-enabled",
      "--guard-disabled",
    ])).rejects.toThrow();
  });

  it("saveConfig writes the config file with restrictive permissions", () => {
    vi.mocked(configUtils.saveConfig).mockRestore();
    configUtils.saveConfig({ network: "testnet", pollingIntervalSeconds: 300 }, configPath);

    expect(fs.existsSync(configPath)).toBe(true);
    const mode = fs.statSync(configPath).mode & 0o777;
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    } else {
      expect([0o600, 0o666]).toContain(mode);
    }
  });
});
