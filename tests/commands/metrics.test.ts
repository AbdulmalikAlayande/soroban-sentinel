import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerMetricsCommand } from "../../src/commands/metrics";
import { insertContract, upsertEntry } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = (await importOriginal()) as object;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

function parse(args: string[]): Promise<void> {
    const program = new Command();
    registerMetricsCommand(program);
    return program.parseAsync(["node", "sorokeep", ...args]);
}

describe("metrics command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prints valid Prometheus exposition text by default", async () => {
        insertContract(mockDb, { id: "C1", network: "testnet" });
        upsertEntry(mockDb, { contract_id: "C1", entry_key_xdr: "xdr1", entry_type: "instance" });

        await parse(["metrics"]);

        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("# HELP sorokeep_contracts_tracked");
        expect(output).toContain("# TYPE sorokeep_contracts_tracked gauge");
        expect(output).toMatch(/^sorokeep_contracts_tracked\{network="testnet"\} 1$/m);
        // Must not be JSON — Prometheus exposition text starts with a comment line.
        expect(() => JSON.parse(output)).toThrow();
    });

    it("matches what the HTTP /metrics endpoint would return for the same database state", async () => {
        insertContract(mockDb, { id: "C1", network: "testnet" });

        const { register, collectAllMetrics } = await import("../../src/observability/registry.js");
        collectAllMetrics(mockDb);
        const expected = await register.metrics();

        await parse(["metrics"]);
        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");

        expect(output).toBe(expected);
    });

    it("prints valid, parseable JSON with --json", async () => {
        insertContract(mockDb, { id: "C1", network: "testnet" });
        insertContract(mockDb, { id: "C2", network: "mainnet" });

        await parse(["metrics", "--json"]);

        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        const parsed = JSON.parse(output);

        expect(Array.isArray(parsed)).toBe(true);
        const contractsMetric = parsed.find((m: { name: string }) => m.name === "sorokeep_contracts_tracked");
        expect(contractsMetric).toBeDefined();
        expect(contractsMetric.values).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ labels: { network: "testnet" }, value: 1 }),
                expect.objectContaining({ labels: { network: "mainnet" }, value: 1 }),
            ]),
        );
    });

    it("prints a valid-but-empty-ish snapshot when the database has no data", async () => {
        await parse(["metrics"]);
        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("# HELP sorokeep_contracts_tracked");
    });
});
