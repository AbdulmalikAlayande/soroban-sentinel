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
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockRunDiagnostics.mockReset();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("exits with code 1 when any check fails", async () => {
        mockRunDiagnostics.mockResolvedValue([
            { check: "node version", status: "ok", detail: "ok" },
            { check: "rpc reachability", status: "fail", detail: "unreachable" },
        ]);

        const program = new Command();
        registerDoctorCommand(program);

        await expect(async () => {
            await program.parseAsync(["node", "sorokeep", "doctor"]);
        }).rejects.toThrow("process.exit called");

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with code 0 when all checks pass or warn", async () => {
        mockRunDiagnostics.mockResolvedValue([
            { check: "node version", status: "ok", detail: "ok" },
            { check: "rpc reachability", status: "warn", detail: "slow" },
        ]);

        const program = new Command();
        registerDoctorCommand(program);

        await expect(program.parseAsync(["node", "sorokeep", "doctor"])).resolves.toBeUndefined();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
