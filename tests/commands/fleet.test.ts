import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import * as dbLib from "../../src/db/database";
import * as repoModule from "../../src/db/repositories";
import { registerFleetCommand } from "../../src/commands/fleet";

vi.mock("../../src/db/database", () => ({
    getDatabase: vi.fn(),
}));

vi.mock("../../src/db/repositories", () => ({
    getAllContracts: vi.fn(),
    getEntriesForContract: vi.fn(),
}));

describe("fleet command", () => {
    let actionFn: (options: { format?: string; json?: boolean }) => void;
    let mockExit: ReturnType<typeof vi.spyOn>;
    let mockLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const program = new Command();
        vi.spyOn(Command.prototype, "action").mockImplementation(function (this: any, fn: any) {
            actionFn = fn;
            return this;
        });

        registerFleetCommand(program);
        mockExit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(dbLib.getDatabase).mockReturnValue({} as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("outputs CSV header only when the fleet is empty", () => {
        vi.mocked(repoModule.getAllContracts).mockReturnValue([]);
        actionFn({ format: "csv" });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(output.trim()).toBe("contract_id,entry_key_xdr,entry_type,remaining_ttl,status");
    });

    it("formats multiple entries into CSV correctly when --format csv is passed", () => {
        vi.mocked(repoModule.getAllContracts).mockReturnValue([
            {
                id: "C1",
                name: "Contract One",
                network: "testnet",
                active: 1,
                last_checked_ledger: 400000,
                registered_at: new Date()
            } as any,
            {
                id: "C2",
                name: "Contract Two",
                network: "testnet",
                active: 1,
                last_checked_ledger: 400000,
                registered_at: new Date()
            } as any
        ]);

        vi.mocked(repoModule.getEntriesForContract).mockImplementation((db: any, contractId: string) => {
            if (contractId === "C1") {
                return [
                    {
                        contract_id: "C1",
                        entry_key_xdr: "K1",
                        entry_type: "instance",
                        live_until_ledger: 410000
                    } as any
                ];
            } else {
                return [
                    {
                        contract_id: "C2",
                        entry_key_xdr: "K2",
                        entry_type: "wasm",
                        live_until_ledger: 395000
                    } as any
                ];
            }
        });

        actionFn({ format: "csv" });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        const lines = output.trim().split("\n");

        expect(lines[0]).toBe("contract_id,entry_key_xdr,entry_type,remaining_ttl,status");
        expect(lines[1]).toBe("C1,K1,instance,10000,warning");
        expect(lines[2]).toBe("C2,K2,wasm,-5000,expired");
    });

    it("uses JSON formatter when --format json or --json is passed", () => {
        vi.mocked(repoModule.getAllContracts).mockReturnValue([
            {
                id: "C1",
                name: "Contract One",
                network: "testnet",
                active: 1,
                last_checked_ledger: 400000,
                registered_at: new Date()
            } as any
        ]);
        vi.mocked(repoModule.getEntriesForContract).mockReturnValue([
            {
                contract_id: "C1",
                entry_key_xdr: "K1",
                entry_type: "instance",
                live_until_ledger: 410000
            } as any
        ]);

        actionFn({ json: true });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        const parsed = JSON.parse(output);

        expect(parsed).toBeInstanceOf(Array);
        expect(parsed[0]).toMatchObject({
            contractId: "C1",
            entryKeyXdr: "K1",
            entryType: "instance",
            remainingTTL: 10000,
            status: "warning"
        });
    });

    it("uses pretty table output by default", () => {
        vi.mocked(repoModule.getAllContracts).mockReturnValue([
            {
                id: "C1",
                name: "Contract One",
                network: "testnet",
                active: 1,
                last_checked_ledger: 400000,
                registered_at: new Date()
            } as any
        ]);
        vi.mocked(repoModule.getEntriesForContract).mockReturnValue([
            {
                contract_id: "C1",
                entry_key_xdr: "K1",
                entry_type: "instance",
                live_until_ledger: 410000
            } as any
        ]);

        actionFn({});

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(output).toContain("C1");
        expect(output).toContain("instance");
        expect(output).not.toContain("contract_id,entry_key_xdr");
    });
});
