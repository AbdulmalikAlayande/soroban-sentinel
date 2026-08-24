import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const { mockRunDiagnostics } = vi.hoisted(() => ({
  mockRunDiagnostics: vi.fn(),
}));

vi.mock("../../src/core/doctor.js", () => ({
  runDiagnostics: mockRunDiagnostics,
}));

import { registerDoctorCommand } from "../../src/commands/doctor";

describe("doctor command", () => {
  let originalExitCode: number;

  beforeEach(() => {
    mockRunDiagnostics.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    originalExitCode = process.exitCode;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("exits with code 1 when any check fails", async () => {
    mockRunDiagnostics.mockResolvedValue([
      { check: "node version", status: "ok", detail: "ok" },
      { check: "rpc reachability", status: "fail", detail: "unreachable" },
    ]);

    const program = new Command();
    registerDoctorCommand(program);

    await program.parseAsync(["node", "sorokeep", "doctor"]);

    expect(process.exitCode).toBe(1);
  });

  it("does not exit with an error when all checks pass or warn", async () => {
    mockRunDiagnostics.mockResolvedValue([
      { check: "node version", status: "ok", detail: "ok" },
      { check: "rpc reachability", status: "warn", detail: "slow" },
    ]);

    const program = new Command();
    registerDoctorCommand(program);

    await program.parseAsync(["node", "sorokeep", "doctor"]);
    expect(process.exitCode).toBe(undefined);
  });
});
