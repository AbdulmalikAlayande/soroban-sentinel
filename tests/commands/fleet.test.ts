import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import * as dbLib from "../../src/db/database";
import * as repoModule from "../../src/db/repositories";
import { registerFleetCommand } from "../../src/commands/fleet";

vi.mock("../../src/db/database", () => ({
    getDatabase: vi.fn(),
}));

vi.mock("../../src/db/repositories", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/repositories")>();
    return {
        ...actual,
        getAllContracts: vi.fn(),
    };
});

describe("fleet status command", () => {
    let actionFn: (options: { page?: number; pageSize?: number }) => void;
    let mockExit: ReturnType<typeof vi.spyOn>;
    let mockLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const program = new Command();
        const actions: Map<string, Function> = new Map();

        const origCommand = Command.prototype.command;
        vi.spyOn(Command.prototype, "command").mockImplementation(function (this: any, name: string, ...args: any[]) {
            const cmd = origCommand.call(this, name, ...args);
            vi.spyOn(cmd, "action").mockImplementation(function (this: any, fn: any) {
                actions.set(name, fn);
                return this;
            });
            return cmd;
        });

        registerFleetCommand(program);
        actionFn = actions.get("status") as any;
        mockExit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(dbLib.getDatabase).mockReturnValue({} as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows fleet status header", () => {
        const contracts = Array.from({ length: 5 }, (_, i) => ({
            id: `contract-${i + 1}`,
            name: `Name-${i + 1}`,
            network: "testnet",
            last_checked_ledger: 400000 + i,
            wasm_hash: null,
            tags: null,
            poll_interval_seconds: null,
            active: 1,
            registered_at: new Date(),
        }));
        vi.mocked(repoModule.getAllContracts).mockReturnValue(contracts as any);

        actionFn({ page: 1, pageSize: 25 });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(output).toContain("Fleet Status");
    });

    it("shows 25 items on page 1 for 60 contracts", () => {
        const contracts = Array.from({ length: 60 }, (_, i) => ({
            id: `contract-${i + 1}`,
            name: `Name-${i + 1}`,
            network: "testnet",
            last_checked_ledger: 400000 + i,
            wasm_hash: null,
            tags: null,
            poll_interval_seconds: null,
            active: 1,
            registered_at: new Date(),
        }));
        vi.mocked(repoModule.getAllContracts).mockReturnValue(contracts as any);

        actionFn({ page: 1, pageSize: 25 });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        const lines = output.split("\n").filter(l => l.includes("contract-"));
        expect(lines).toHaveLength(25);
        expect(lines[0]).toContain("contract-1");
        expect(lines[24]).toContain("contract-25");
    });

    it("shows 25 items on page 2 and 10 on page 3", () => {
        const contracts = Array.from({ length: 60 }, (_, i) => ({
            id: `contract-${i + 1}`,
            name: `Name-${i + 1}`,
            network: "testnet",
            last_checked_ledger: 400000 + i,
            wasm_hash: null,
            tags: null,
            poll_interval_seconds: null,
            active: 1,
            registered_at: new Date(),
        }));
        vi.mocked(repoModule.getAllContracts).mockReturnValue(contracts as any);

        actionFn({ page: 2, pageSize: 25 });
        let output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        let lines = output.split("\n").filter(l => l.includes("contract-"));
        expect(lines).toHaveLength(25);
        expect(lines[0]).toContain("contract-26");

        vi.clearAllMocks();
        mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

        actionFn({ page: 3, pageSize: 25 });
        output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        lines = output.split("\n").filter(l => l.includes("contract-"));
        expect(lines).toHaveLength(10);
        expect(lines[0]).toContain("contract-51");
        expect(lines[9]).toContain("contract-60");
    });

    it("shows pagination footer with page info", () => {
        const contracts = Array.from({ length: 60 }, (_, i) => ({
            id: `contract-${i + 1}`,
            name: `Name-${i + 1}`,
            network: "testnet",
            last_checked_ledger: 400000 + i,
            wasm_hash: null,
            tags: null,
            poll_interval_seconds: null,
            active: 1,
            registered_at: new Date(),
        }));
        vi.mocked(repoModule.getAllContracts).mockReturnValue(contracts as any);

        actionFn({ page: 1, pageSize: 25 });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(output).toContain("Page 1 of 3 (60 total)");
    });

    it("shows out-of-range message when page exceeds total pages", () => {
        const contracts = Array.from({ length: 60 }, (_, i) => ({
            id: `contract-${i + 1}`,
            name: `Name-${i + 1}`,
            network: "testnet",
            last_checked_ledger: 400000 + i,
            wasm_hash: null,
            tags: null,
            poll_interval_seconds: null,
            active: 1,
            registered_at: new Date(),
        }));
        vi.mocked(repoModule.getAllContracts).mockReturnValue(contracts as any);

        actionFn({ page: 99, pageSize: 25 });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(output).toContain("is out of range");
    });

    it("shows empty message when no contracts exist", () => {
        vi.mocked(repoModule.getAllContracts).mockReturnValue([]);

        actionFn({ page: 1, pageSize: 25 });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(output).toContain("No contracts in fleet");
    });
});
