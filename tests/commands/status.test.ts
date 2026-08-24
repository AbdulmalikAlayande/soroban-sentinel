import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import stripAnsi from "strip-ansi";
import * as dbLib from "../../src/db/database";
import { ContractNotFoundError } from "../../src/core/status";
import * as statusModule from "../../src/core/status";
import * as repoModule from "../../src/db/repositories";
import { registerStatusCommand } from "../../src/commands/status";

const SNAPSHOT_TIMESTAMP = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g;
function normalizeOutput(output: string): string {
    return stripAnsi(output).replace(SNAPSHOT_TIMESTAMP, "YYYY-MM-DD HH:MM:SS");
}

vi.mock("../../src/db/database", () => ({
    getDatabase: vi.fn(),
}));

vi.mock("../../src/core/status", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/core/status")>();
    return {
        ...actual,
        getContractStatus: vi.fn(),
    };
});

vi.mock("../../src/db/repositories", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/repositories")>();
    return {
        ...actual,
        getAllContracts: vi.fn(),
    };
});

function makeContracts(count: number) {
    return Array.from({ length: count }, (_, i) => ({
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
}

describe("status command", () => {
    const contractID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
    let actionFn: (contractId: string, options: { json?: boolean }) => void;
    let listActionFn: (options: { page?: string; pageSize?: string }) => void;
    let mockExit: ReturnType<typeof vi.spyOn>;
    let mockLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const program = new Command();
        const capturedActions: Array<(...args: any[]) => void> = [];
        vi.spyOn(Command.prototype, "action").mockImplementation(function (this: any, fn: any) {
            capturedActions.push(fn);
            return this;
        });

        registerStatusCommand(program);
        // registerStatusCommand registers "list"'s action first, then the
        // default <contractId> action — order is deterministic.
        listActionFn = capturedActions[0] as any;
        actionFn = capturedActions[1] as any;
        mockExit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(dbLib.getDatabase).mockReturnValue({} as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prints JSON payload when --json is provided", () => {
        vi.mocked(statusModule.getContractStatus).mockReturnValue({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
            entries: [
                {
                    label: "Instance",
                    entryType: "instance",
                    entryKeyXdr: "AAAAA",
                    liveUntilLedger: 500000,
                    remainingTTL: 100000,
                    approximateTimeRemaining: "~1 day",
                    status: "ok",
                },
            ],
        } as any);

        actionFn(contractID, { json: true });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        const parsed = JSON.parse(output);

        expect(parsed).toMatchObject({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
        });
        expect(parsed.entries).toHaveLength(1);
        expect(output).not.toContain("\u001b[");
    });

    it("prints human-readable output by default", () => {
        vi.mocked(statusModule.getContractStatus).mockReturnValue({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
            entries: [
                {
                    label: "Instance",
                    entryType: "instance",
                    entryKeyXdr: "AAAAA",
                    liveUntilLedger: 500000,
                    remainingTTL: 100000,
                    approximateTimeRemaining: "~1 day",
                    status: "ok",
                },
            ],
        } as any);

        actionFn(contractID, { json: false });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");

        expect(output).toContain("Network:");
        expect(output).toContain("TTL:");
        expect(output).not.toContain("\"contractId\"");
    });

    it("exits with code 1 if contract is not found", () => {
        vi.mocked(statusModule.getContractStatus).mockImplementation(() => {
            throw new ContractNotFoundError("CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ");
        });

        actionFn("CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ", { json: false });

        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("is not registered"));
    });

    it("re-throws unknown errors", () => {
        vi.mocked(statusModule.getContractStatus).mockImplementation(() => {
            throw new Error("DB Corrupt");
        });

        expect(() => actionFn("CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526", { json: false })).toThrow("DB Corrupt");
    });

    // ── Snapshot tests ──────────────────────────────────────────────────

    it("matches snapshot for human-readable output", () => {
        vi.mocked(statusModule.getContractStatus).mockReturnValue({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
            entries: [
                {
                    label: "Instance",
                    entryType: "instance",
                    entryKeyXdr: "AAAAA",
                    liveUntilLedger: 500000,
                    remainingTTL: 100000,
                    approximateTimeRemaining: "~1 day",
                    status: "ok",
                },
            ],
        } as any);

        actionFn(contractID, { json: false });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(normalizeOutput(output)).toMatchSnapshot();
    });

    it("matches snapshot when no entries are tracked", () => {
        vi.mocked(statusModule.getContractStatus).mockReturnValue({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
            entries: [],
        } as any);

        actionFn(contractID, { json: false });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(normalizeOutput(output)).toMatchSnapshot();
    });

    it("matches snapshot for contracts with mixed TTL statuses", () => {
        vi.mocked(statusModule.getContractStatus).mockReturnValue({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
            entries: [
                {
                    label: "Instance",
                    entryType: "instance",
                    entryKeyXdr: "AAAAA",
                    liveUntilLedger: 500000,
                    remainingTTL: 100000,
                    approximateTimeRemaining: "~1 day",
                    status: "ok",
                },
                {
                    label: "WASM Code",
                    entryType: "wasm",
                    entryKeyXdr: "BBBBB",
                    liveUntilLedger: 410000,
                    remainingTTL: 10000,
                    approximateTimeRemaining: "~15 hours",
                    status: "warning",
                },
                {
                    label: "Temporary",
                    entryType: "temporary",
                    entryKeyXdr: "CCCCC",
                    liveUntilLedger: 404000,
                    remainingTTL: 4000,
                    approximateTimeRemaining: "~6 hours",
                    status: "critical",
                },
            ],
        } as any);

        actionFn(contractID, { json: false });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(normalizeOutput(output)).toMatchSnapshot();
    });

    it("matches snapshot for unknown entry status", () => {
        vi.mocked(statusModule.getContractStatus).mockReturnValue({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: null,
            entries: [
                {
                    label: "Instance",
                    entryType: "instance",
                    entryKeyXdr: "AAAAA",
                    liveUntilLedger: null,
                    remainingTTL: null,
                    approximateTimeRemaining: null,
                    status: "unknown",
                },
            ],
        } as any);

        actionFn(contractID, { json: false });

        const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
        expect(normalizeOutput(output)).toMatchSnapshot();
    });

    // ── status list (pagination, #408) ────────────────────────────────────

    describe("status list", () => {
        it("lists all contracts with a pagination footer", () => {
            vi.mocked(repoModule.getAllContracts).mockReturnValue(makeContracts(60) as any);

            listActionFn({ page: "1", pageSize: "25" });

            const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
            expect(output).toContain("Watched Contracts");
            expect(output).toContain("Page 1 of 3 (60 total)");
        });

        it("shows 25 items on page 1 for 60 contracts", () => {
            vi.mocked(repoModule.getAllContracts).mockReturnValue(makeContracts(60) as any);

            listActionFn({ page: "1", pageSize: "25" });

            const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
            const lines = output.split("\n").filter((l) => l.includes("contract-"));
            expect(lines).toHaveLength(25);
            expect(lines[0]).toContain("contract-1");
            expect(lines[24]).toContain("contract-25");
        });

        it("shows the remaining 10 items on page 3 for 60 contracts with page-size 25", () => {
            vi.mocked(repoModule.getAllContracts).mockReturnValue(makeContracts(60) as any);

            listActionFn({ page: "3", pageSize: "25" });

            const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
            const lines = output.split("\n").filter((l) => l.includes("contract-"));
            expect(lines).toHaveLength(10);
            expect(lines[0]).toContain("contract-51");
            expect(lines[9]).toContain("contract-60");
        });

        it("clamps an out-of-range page to the last valid page instead of showing empty or error output", () => {
            vi.mocked(repoModule.getAllContracts).mockReturnValue(makeContracts(60) as any);

            listActionFn({ page: "99", pageSize: "25" });

            const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
            expect(output).toContain("Watched Contracts");
            expect(output).toContain("Page 3 of 3 (60 total)");
        });

        it("shows a friendly message when no contracts are watched", () => {
            vi.mocked(repoModule.getAllContracts).mockReturnValue([]);

            listActionFn({ page: "1", pageSize: "25" });

            const output = mockLog.mock.calls.map((args) => args.join(" ")).join("\n");
            expect(output).toContain("No contracts watched yet");
        });
    });
});
