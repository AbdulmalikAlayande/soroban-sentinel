import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { getDatabaseForTesting } from "../../src/db/database";
import type Database from "better-sqlite3";

// ─── Mock fetch before importing the module under test ────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
    buildFleetDigest,
    deliverDigestPayload,
    type DigestPayload,
    type DigestContractSummary,
} from "../../src/core/digest";
import {
    insertContract,
    upsertEntry,
    recordExtension,
    insertDigestConfig,
    getDigestConfigs,
    type DigestConfig,
} from "../../src/db/repositories";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedContract(
    db: Database.Database,
    id: string,
    network = "testnet",
    name: string | null = null,
): void {
    insertContract(db, { id, network, name: name ?? undefined });
}

function seedEntry(
    db: Database.Database,
    contractId: string,
    keyXdr: string,
    liveUntilLedger: number,
    currentLedger: number,
    entryType: "instance" | "wasm" | "persistent" | "temporary" = "instance",
): void {
    upsertEntry(db, {
        contract_id: contractId,
        entry_key_xdr: keyXdr,
        entry_type: entryType,
        live_until_ledger: liveUntilLedger,
    });
    // Set last_checked_ledger on the contract so we know what "current" is
    db.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(
        currentLedger,
        contractId,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildFleetDigest", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    // ── Shape / structure ────────────────────────────────────────────────────

    it("returns a DigestPayload with the expected top-level shape", () => {
        const digest = buildFleetDigest(db, "testnet", 1_000_000);

        expect(digest).toMatchObject<Partial<DigestPayload>>({
            type: "fleet_digest",
            network: "testnet",
            generatedAtLedger: 1_000_000,
            totalContracts: expect.any(Number),
            severityCounts: expect.objectContaining({
                critical: expect.any(Number),
                warning: expect.any(Number),
                ok: expect.any(Number),
            }),
            topExpiring: expect.any(Array),
            totalCostXlmPeriod: expect.any(Number),
            timestamp: expect.any(String),
        });
    });

    it("includes a valid ISO-8601 timestamp", () => {
        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(() => new Date(digest.timestamp)).not.toThrow();
        expect(new Date(digest.timestamp).toISOString()).toBe(digest.timestamp);
    });

    // ── Empty fleet ──────────────────────────────────────────────────────────

    it("returns zero counts and empty topExpiring for an empty fleet", () => {
        const digest = buildFleetDigest(db, "testnet", 1_000_000);

        expect(digest.totalContracts).toBe(0);
        expect(digest.severityCounts.critical).toBe(0);
        expect(digest.severityCounts.warning).toBe(0);
        expect(digest.severityCounts.ok).toBe(0);
        expect(digest.topExpiring).toHaveLength(0);
        expect(digest.totalCostXlmPeriod).toBe(0);
    });

    // ── Severity counting ────────────────────────────────────────────────────

    it("classifies entries with TTL <= 0 as critical", () => {
        seedContract(db, "C1");
        seedEntry(db, "C1", "KEY1", 999_999, 1_000_000);   // remaining = -1 (expired)

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.severityCounts.critical).toBe(1);
        expect(digest.severityCounts.warning).toBe(0);
        expect(digest.severityCounts.ok).toBe(0);
    });

    it("classifies entries with remaining TTL < 5000 as critical", () => {
        seedContract(db, "C1");
        seedEntry(db, "C1", "KEY1", 1_004_999, 1_000_000); // remaining = 4999 < 5000

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.severityCounts.critical).toBe(1);
    });

    it("classifies entries with 5000 <= remaining TTL < 20000 as warning", () => {
        seedContract(db, "C1");
        seedEntry(db, "C1", "KEY1", 1_010_000, 1_000_000); // remaining = 10000

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.severityCounts.warning).toBe(1);
        expect(digest.severityCounts.critical).toBe(0);
    });

    it("classifies entries with remaining TTL >= 20000 as ok", () => {
        seedContract(db, "C1");
        seedEntry(db, "C1", "KEY1", 1_025_000, 1_000_000); // remaining = 25000

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.severityCounts.ok).toBe(1);
        expect(digest.severityCounts.warning).toBe(0);
        expect(digest.severityCounts.critical).toBe(0);
    });

    it("aggregates severity across multiple contracts and entries", () => {
        seedContract(db, "C1");
        seedEntry(db, "C1", "KEY1", 1_025_000, 1_000_000); // ok
        seedEntry(db, "C1", "KEY2", 1_010_000, 1_000_000); // warning

        seedContract(db, "C2");
        seedEntry(db, "C2", "KEY3", 1_003_000, 1_000_000); // critical
        seedEntry(db, "C2", "KEY4", 1_050_000, 1_000_000); // ok

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.totalContracts).toBe(2);
        expect(digest.severityCounts.ok).toBe(2);
        expect(digest.severityCounts.warning).toBe(1);
        expect(digest.severityCounts.critical).toBe(1);
    });

    // ── Network isolation ────────────────────────────────────────────────────

    it("only counts contracts on the requested network", () => {
        seedContract(db, "C_TESTNET", "testnet");
        seedEntry(db, "C_TESTNET", "KEY_T", 1_025_000, 1_000_000);

        seedContract(db, "C_MAINNET", "mainnet");
        seedEntry(db, "C_MAINNET", "KEY_M", 1_010_000, 1_000_000);

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.totalContracts).toBe(1);
        expect(digest.severityCounts.ok).toBe(1);
        expect(digest.severityCounts.warning).toBe(0);
    });

    // ── topExpiring ──────────────────────────────────────────────────────────

    it("topExpiring lists contracts sorted by minimum remaining TTL ascending", () => {
        seedContract(db, "C_HIGH", "testnet", "High TTL");
        seedEntry(db, "C_HIGH", "KEY_H", 1_050_000, 1_000_000); // remaining = 50000

        seedContract(db, "C_LOW", "testnet", "Low TTL");
        seedEntry(db, "C_LOW", "KEY_L", 1_005_000, 1_000_000); // remaining = 5000

        seedContract(db, "C_MED", "testnet", "Med TTL");
        seedEntry(db, "C_MED", "KEY_M", 1_020_000, 1_000_000); // remaining = 20000

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.topExpiring[0]?.contractId).toBe("C_LOW");
        expect(digest.topExpiring[1]?.contractId).toBe("C_MED");
        expect(digest.topExpiring[2]?.contractId).toBe("C_HIGH");
    });

    it("topExpiring is capped at 10 entries by default", () => {
        for (let i = 0; i < 15; i++) {
            const id = `C${i}`;
            seedContract(db, id);
            seedEntry(db, id, `KEY${i}`, 1_000_000 + 1000 * (i + 1), 1_000_000);
        }

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.topExpiring.length).toBeLessThanOrEqual(10);
    });

    it("topExpiring respects a custom topN limit", () => {
        for (let i = 0; i < 8; i++) {
            const id = `C${i}`;
            seedContract(db, id);
            seedEntry(db, id, `KEY${i}`, 1_000_000 + 1000 * (i + 1), 1_000_000);
        }

        const digest = buildFleetDigest(db, "testnet", 1_000_000, { topN: 3 });
        expect(digest.topExpiring.length).toBeLessThanOrEqual(3);
    });

    it("topExpiring contract summary includes expected fields", () => {
        seedContract(db, "C1", "testnet", "My Contract");
        seedEntry(db, "C1", "KEY1", 1_010_000, 1_000_000); // remaining = 10000

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        const summary = digest.topExpiring[0];

        expect(summary).toBeDefined();
        expect(summary?.contractId).toBe("C1");
        expect(summary?.contractName).toBe("My Contract");
        expect(summary?.minRemainingLedgers).toBe(10_000);
        expect(summary?.severity).toBe("warning");
        expect(typeof summary?.approximateTimeRemaining).toBe("string");
    });

    it("uses minimum remaining TTL across all entries of a contract for topExpiring", () => {
        seedContract(db, "C1", "testnet");
        seedEntry(db, "C1", "KEY1", 1_050_000, 1_000_000); // remaining = 50000
        seedEntry(db, "C1", "KEY2", 1_003_000, 1_000_000); // remaining = 3000 (critical — drives the summary)

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.topExpiring[0]?.minRemainingLedgers).toBe(3_000);
        expect(digest.topExpiring[0]?.severity).toBe("critical");
    });

    // ── Cost period ──────────────────────────────────────────────────────────

    it("totalCostXlmPeriod is 0 when there are no extensions", () => {
        seedContract(db, "C1");
        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.totalCostXlmPeriod).toBe(0);
    });

    it("totalCostXlmPeriod sums costs across all contracts in the network", () => {
        seedContract(db, "C1");
        seedEntry(db, "C1", "KEY1", 1_025_000, 1_000_000);
        // Insert a fake entry id to reference
        const entryRow = db
            .prepare("SELECT id FROM contract_entries WHERE contract_id = ?")
            .get("C1") as { id: number };

        recordExtension(db, {
            contract_id: "C1",
            contract_entry_id: entryRow.id,
            old_ttl_ledgers: 1_000,
            new_ttl_ledgers: 100_000,
            tx_hash: "HASH1",
            cost_xlm: 0.5,
            executed_at_ledger: 999_990,
        });
        recordExtension(db, {
            contract_id: "C1",
            contract_entry_id: entryRow.id,
            old_ttl_ledgers: 1_000,
            new_ttl_ledgers: 100_000,
            tx_hash: "HASH2",
            cost_xlm: 0.3,
            executed_at_ledger: 999_995,
        });

        seedContract(db, "C2");
        seedEntry(db, "C2", "KEY2", 1_025_000, 1_000_000);
        const entryRow2 = db
            .prepare("SELECT id FROM contract_entries WHERE contract_id = ?")
            .get("C2") as { id: number };

        recordExtension(db, {
            contract_id: "C2",
            contract_entry_id: entryRow2.id,
            old_ttl_ledgers: 1_000,
            new_ttl_ledgers: 100_000,
            tx_hash: "HASH3",
            cost_xlm: 0.2,
            executed_at_ledger: 999_998,
        });

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.totalCostXlmPeriod).toBeCloseTo(1.0, 6);
    });

    it("totalCostXlmPeriod excludes costs from other networks", () => {
        // testnet contract
        seedContract(db, "C1", "testnet");
        seedEntry(db, "C1", "KEY1", 1_025_000, 1_000_000);
        const e1 = db
            .prepare("SELECT id FROM contract_entries WHERE contract_id = ?")
            .get("C1") as { id: number };
        recordExtension(db, {
            contract_id: "C1",
            contract_entry_id: e1.id,
            old_ttl_ledgers: 1_000,
            new_ttl_ledgers: 100_000,
            tx_hash: "HASH1",
            cost_xlm: 1.5,
            executed_at_ledger: 999_990,
        });

        // mainnet contract — should NOT be included
        seedContract(db, "C2", "mainnet");
        seedEntry(db, "C2", "KEY2", 1_025_000, 1_000_000);
        const e2 = db
            .prepare("SELECT id FROM contract_entries WHERE contract_id = ?")
            .get("C2") as { id: number };
        recordExtension(db, {
            contract_id: "C2",
            contract_entry_id: e2.id,
            old_ttl_ledgers: 1_000,
            new_ttl_ledgers: 100_000,
            tx_hash: "HASH2",
            cost_xlm: 9.9,
            executed_at_ledger: 999_990,
        });

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.totalCostXlmPeriod).toBeCloseTo(1.5, 6);
    });

    // ── Reflects fleet state at generation time ───────────────────────────────

    it("accurately reflects the fleet state AT the time of generation (AC #2)", () => {
        seedContract(db, "C1", "testnet", "Alpha");
        seedEntry(db, "C1", "KEY1", 1_003_000, 1_000_000); // critical

        const digest1 = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest1.severityCounts.critical).toBe(1);
        expect(digest1.topExpiring[0]?.contractName).toBe("Alpha");

        // Update the entry TTL to a healthy value
        upsertEntry(db, {
            contract_id: "C1",
            entry_key_xdr: "KEY1",
            entry_type: "instance",
            live_until_ledger: 1_080_000,
        });
        db.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(
            1_001_000,
            "C1",
        );

        const digest2 = buildFleetDigest(db, "testnet", 1_001_000);
        expect(digest2.severityCounts.critical).toBe(0);
        expect(digest2.severityCounts.ok).toBe(1);
    });

    // ── Inactive contracts ────────────────────────────────────────────────────

    it("excludes inactive contracts from the digest", () => {
        seedContract(db, "C_ACTIVE");
        seedEntry(db, "C_ACTIVE", "KEY1", 1_025_000, 1_000_000);

        insertContract(db, { id: "C_INACTIVE", network: "testnet", active: 0 });
        upsertEntry(db, {
            contract_id: "C_INACTIVE",
            entry_key_xdr: "KEY2",
            entry_type: "instance",
            live_until_ledger: 1_003_000,
        });

        const digest = buildFleetDigest(db, "testnet", 1_000_000);
        expect(digest.totalContracts).toBe(1);
        expect(digest.severityCounts.critical).toBe(0);
    });
});

// ─── DigestConfig repository tests ───────────────────────────────────────────

describe("digest_configs repository", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    it("can insert and retrieve a digest config", () => {
        const id = insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 86_400_000,
        });
        expect(id).toBeGreaterThan(0);

        const configs = getDigestConfigs(db, "testnet");
        expect(configs).toHaveLength(1);
        expect(configs[0]).toMatchObject<Partial<DigestConfig>>({
            id,
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 86_400_000,
            enabled: 1,
            webhook_secret: null,
        });
    });

    it("can insert a digest config with a webhook secret", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 3_600_000,
            webhook_secret: "my-secret",
        });

        const configs = getDigestConfigs(db, "testnet");
        expect(configs[0]?.webhook_secret).toBe("my-secret");
    });

    it("getDigestConfigs only returns configs for the requested network", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://test.example.com",
            interval_ms: 86_400_000,
        });
        insertDigestConfig(db, {
            network: "mainnet",
            channel_type: "webhook",
            channel_target: "https://main.example.com",
            interval_ms: 86_400_000,
        });

        const testnetConfigs = getDigestConfigs(db, "testnet");
        expect(testnetConfigs).toHaveLength(1);
        expect(testnetConfigs[0]?.network).toBe("testnet");
    });

    it("getDigestConfigs returns only enabled configs by default", () => {
        const id = insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 86_400_000,
        });
        // Disable it
        db.prepare("UPDATE digest_configs SET enabled = 0 WHERE id = ?").run(id);

        const configs = getDigestConfigs(db, "testnet");
        expect(configs).toHaveLength(0);
    });
});

// ─── deliverDigestPayload ─────────────────────────────────────────────────────

function makeDigestPayload(overrides: Partial<DigestPayload> = {}): DigestPayload {
    return {
        type: "fleet_digest",
        network: "testnet",
        generatedAtLedger: 1_000_000,
        totalContracts: 3,
        severityCounts: { critical: 1, warning: 1, ok: 1 },
        topExpiring: [],
        totalCostXlmPeriod: 0.5,
        timestamp: "2026-05-21T20:37:08.000Z",
        ...overrides,
    };
}

function makeOkResponse(status = 200): Response {
    return new Response(JSON.stringify({ ok: true }), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function makeErrorResponse(status: number, body = "Bad Request"): Response {
    return new Response(body, { status });
}

describe("deliverDigestPayload", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", mockFetch);
    });

    describe("supported channel types", () => {
        it("posts to the target URL for channelType 'webhook'", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await deliverDigestPayload("webhook", "https://example.com/digest", makeDigestPayload());

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, options] = mockFetch.mock.calls[0]!;
            expect(url).toBe("https://example.com/digest");
            expect(options.method).toBe("POST");
        });

        it("posts to the target URL for channelType 'webhook2'", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await deliverDigestPayload("webhook2", "https://example.com/digest2", makeDigestPayload());

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("sends the DigestPayload as the JSON body", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const payload = makeDigestPayload({ totalContracts: 7 });

            await deliverDigestPayload("webhook", "https://example.com/digest", payload);

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.type).toBe("fleet_digest");
            expect(body.totalContracts).toBe(7);
        });

        it("sets Content-Type to application/json", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await deliverDigestPayload("webhook", "https://example.com/digest", makeDigestPayload());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Content-Type"]).toBe("application/json");
        });
    });

    describe("unsupported channel types", () => {
        it("throws a clear error for an unsupported channel type instead of sending", async () => {
            await expect(
                deliverDigestPayload("slack", "https://hooks.slack.com/x", makeDigestPayload()),
            ).rejects.toThrow(/not yet supported for channel type 'slack'/);

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("throws for channelType 'email'", async () => {
            await expect(
                deliverDigestPayload("email", "ops@example.com", makeDigestPayload()),
            ).rejects.toThrow(/not yet supported/);
        });
    });

    describe("HMAC signing", () => {
        it("includes X-Sorokeep-Signature when a secret is provided", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const secret = "digest-secret";
            const payload = makeDigestPayload();

            await deliverDigestPayload("webhook", "https://example.com/digest", payload, secret);

            const [, options] = mockFetch.mock.calls[0]!;
            const body = options.body as string;
            const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
            expect(options.headers["X-Sorokeep-Signature"]).toBe(`sha256=${expectedSig}`);
        });

        it("omits X-Sorokeep-Signature when no secret is provided", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await deliverDigestPayload("webhook", "https://example.com/digest", makeDigestPayload());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["X-Sorokeep-Signature"]).toBeUndefined();
        });

        it("omits X-Sorokeep-Signature when secret is null", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await deliverDigestPayload("webhook", "https://example.com/digest", makeDigestPayload(), null);

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["X-Sorokeep-Signature"]).toBeUndefined();
        });
    });

    describe("error handling", () => {
        it("throws on a non-2xx response", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(500));

            await expect(
                deliverDigestPayload("webhook", "https://example.com/digest", makeDigestPayload()),
            ).rejects.toThrow("500");
        });

        it("propagates network-level fetch failures", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            await expect(
                deliverDigestPayload("webhook", "https://example.com/digest", makeDigestPayload()),
            ).rejects.toThrow("ECONNREFUSED");
        });
    });

    describe("timeout handling", () => {
        it("aborts the in-flight request after 10 seconds", async () => {
            vi.useFakeTimers();

            let aborted = false;
            mockFetch.mockImplementation((_url: string, options: any) => {
                options.signal.addEventListener("abort", () => { aborted = true; });
                return new Promise(() => {});
            });

            deliverDigestPayload("webhook", "https://slow.example.com/digest", makeDigestPayload()).catch(() => {});

            await vi.advanceTimersByTimeAsync(9_999);
            expect(aborted).toBe(false);

            await vi.advanceTimersByTimeAsync(2);
            expect(aborted).toBe(true);

            vi.useRealTimers();
        });
    });
});
