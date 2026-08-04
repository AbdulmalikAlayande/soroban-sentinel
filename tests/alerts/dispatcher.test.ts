import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import {
    insertContract,
    upsertEntry,
    insertAlertConfig,
    recordAlertFired,
    MAX_RETRY_COUNT,
} from "../../src/db/repositories";
import { deliverPendingAlerts } from "../../src/alerts/dispatcher";
import type { AlertChannel } from "../../src/alerts/types";
import { registerAlertChannel, getAlertChannel, _resetRegistryForTesting } from "../../src/alerts/registry";
import { registerBuiltinChannels, _resetBuiltinRegistrationForTesting } from "../../src/alerts/builtins";

function mockChannel(): AlertChannel & { send: ReturnType<typeof vi.fn> } {
    return { send: vi.fn().mockResolvedValue(undefined) };
}

function seedAlert(
    db: Database.Database,
    opts: {
        contractId: string;
        contractName?: string;
        network?: string;
        entryKeyXdr?: string;
        entryType?: string;
        channelType?: "webhook" | "slack" | "pagerduty";
        channelTarget?: string;
        thresholdLedgers?: number;
        ttlAtFire?: number;
        webhookSecret?: string;
        quietHoursStart?: string;
        quietHoursEnd?: string;
        quietHoursTimezone?: string;
    },
): { entryId: number; alertConfigId: number; alertFiredId: number } {
    const network = opts.network ?? "testnet";
    const entryKeyXdr = opts.entryKeyXdr ?? `key-${opts.contractId}`;

    insertContract(db, { id: opts.contractId, name: opts.contractName, network });
    upsertEntry(db, {
        contract_id: opts.contractId,
        entry_key_xdr: entryKeyXdr,
        entry_type: opts.entryType ?? "instance",
        live_until_ledger: 3_000_000,
        discovery_source: "deterministic",
    });

    const entry = db
        .prepare("SELECT id FROM contract_entries WHERE contract_id = ? AND entry_key_xdr = ?")
        .get(opts.contractId, entryKeyXdr) as { id: number };

    insertAlertConfig(db, {
        contract_id: opts.contractId,
        channel_type: opts.channelType ?? "webhook",
        channel_target: opts.channelTarget ?? "https://example.com/hook",
        threshold_ledgers: opts.thresholdLedgers ?? 20_000,
        webhook_secret: opts.webhookSecret,
        quiet_hours_start: opts.quietHoursStart,
        quiet_hours_end: opts.quietHoursEnd,
        quiet_hours_timezone: opts.quietHoursTimezone,
    });

    const config = db
        .prepare("SELECT id FROM alert_configs WHERE contract_id = ?")
        .get(opts.contractId) as { id: number };

    recordAlertFired(db, {
        alert_config_id: config.id,
        contract_entry_id: entry.id,
        fired_at_ledger: 2_500_000,
        ttl_at_fire: opts.ttlAtFire ?? 8_000,
    });

    const fired = db
        .prepare("SELECT id FROM alerts_fired WHERE alert_config_id = ? AND contract_entry_id = ?")
        .get(config.id, entry.id) as { id: number };

    return { entryId: entry.id, alertConfigId: config.id, alertFiredId: fired.id };
}

describe("deliverPendingAlerts", () => {
    let db: Database.Database;
    let channels: Record<string, AlertChannel & { send: ReturnType<typeof vi.fn> }>;

    beforeEach(() => {
        db = getDatabaseForTesting();
        channels = {
            webhook: mockChannel(),
            slack: mockChannel(),
            pagerduty: mockChannel(),
        };
    });

    describe("Return shape", () => {
        it("returns a DeliveryResult with all required fields when nothing to deliver", async () => {
            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(result).toHaveProperty("attempted");
            expect(result).toHaveProperty("delivered");
            expect(result).toHaveProperty("failed");
            expect(result).toHaveProperty("abandoned");
            expect(result).toHaveProperty("errors");
            expect(Array.isArray(result.errors)).toBe(true);
        });

        it("returns zeros when there are no undelivered alerts", async () => {
            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(result.attempted).toBe(0);
            expect(result.delivered).toBe(0);
            expect(result.failed).toBe(0);
            expect(result.abandoned).toBe(0);
            expect(result.errors).toHaveLength(0);
        });
    });

    describe("Channel routing", () => {
        it("routes webhook alerts to the webhook channel", async () => {
            seedAlert(db, { contractId: "CA", channelType: "webhook", channelTarget: "https://example.com/hook" });

            await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.webhook.send).toHaveBeenCalledTimes(1);
            expect(channels.slack.send).not.toHaveBeenCalled();
        });

        it("routes slack alerts to the slack channel", async () => {
            seedAlert(db, { contractId: "CA", channelType: "slack", channelTarget: "#oncall" });

            await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.slack.send).toHaveBeenCalledTimes(1);
            expect(channels.webhook.send).not.toHaveBeenCalled();
            expect(channels.pagerduty.send).not.toHaveBeenCalled();
        });

        it("routes pagerduty alerts to the pagerduty channel", async () => {
            seedAlert(db, { contractId: "CA", channelType: "pagerduty", channelTarget: "routing-key-123" });

            await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.pagerduty.send).toHaveBeenCalledTimes(1);
            expect(channels.webhook.send).not.toHaveBeenCalled();
            expect(channels.slack.send).not.toHaveBeenCalled();
        });

        it("passes correct target, event payload, and secret to webhook channel", async () => {
            seedAlert(db, {
                contractId: "CTEST1234",
                contractName: "test-contract",
                channelType: "webhook",
                channelTarget: "https://ops.example.com/hook",
                thresholdLedgers: 15_000,
                ttlAtFire: 7_000,
                webhookSecret: "test-secret-123",
            });

            await deliverPendingAlerts(db, "testnet", channels);

            const [url, event, secret] = channels.webhook.send.mock.calls[0]!;
            expect(url).toBe("https://ops.example.com/hook");
            expect(secret).toBe("test-secret-123");
            expect(event.type).toBe("threshold_crossed");
            expect(event.contractId).toBe("CTEST1234");
            expect(event.contractName).toBe("test-contract");
            expect(event.network).toBe("testnet");
            expect(event.severity).toMatch(/^(warning|critical)$/);
            expect(event.threshold.configuredLedgers).toBe(15_000);
            expect(event.threshold.currentRemainingLedgers).toBe(7_000);
            expect(typeof event.threshold.approximateTimeRemaining).toBe("string");
            expect(typeof event.timestamp).toBe("string");
        });

        it("passes correct target and event to slack channel", async () => {
            seedAlert(db, { contractId: "CA", channelType: "slack", channelTarget: "#my-alerts" });

            await deliverPendingAlerts(db, "testnet", channels);

            const [channel, event] = channels.slack.send.mock.calls[0]!;
            expect(channel).toBe("#my-alerts");
            expect(event.type).toBe("threshold_crossed");
        });
    });

    describe("Delivered flag management", () => {
        it("marks the alert as delivered in the DB after successful send", async () => {
            const { alertFiredId } = seedAlert(db, { contractId: "CA" });

            await deliverPendingAlerts(db, "testnet", channels);

            const row = db
                .prepare("SELECT delivered FROM alerts_fired WHERE id = ?")
                .get(alertFiredId) as { delivered: number };
            expect(row.delivered).toBe(1);
        });

        it("does NOT mark as delivered when send fails", async () => {
            channels.webhook.send.mockRejectedValue(new Error("connection refused"));
            const { alertFiredId } = seedAlert(db, { contractId: "CA" });

            await deliverPendingAlerts(db, "testnet", channels);

            const row = db
                .prepare("SELECT delivered FROM alerts_fired WHERE id = ?")
                .get(alertFiredId) as { delivered: number };
            expect(row.delivered).toBe(0);
        });

        it("does not re-deliver already-delivered alerts", async () => {
            seedAlert(db, { contractId: "CA" });

            await deliverPendingAlerts(db, "testnet", channels);
            expect(channels.webhook.send).toHaveBeenCalledTimes(1);

            await deliverPendingAlerts(db, "testnet", channels);
            expect(channels.webhook.send).toHaveBeenCalledTimes(1);
        });

        it("retries a failed alert on the next cycle", async () => {
            channels.webhook.send
                .mockRejectedValueOnce(new Error("Slack down"))
                .mockResolvedValue(undefined);

            const { alertFiredId } = seedAlert(db, { contractId: "CA" });

            await deliverPendingAlerts(db, "testnet", channels);
            expect(channels.webhook.send).toHaveBeenCalledTimes(1);

            let row = db
                .prepare("SELECT delivered, retry_count FROM alerts_fired WHERE id = ?")
                .get(alertFiredId) as { delivered: number; retry_count: number };
            expect(row.delivered).toBe(0);
            expect(row.retry_count).toBe(1);

            await deliverPendingAlerts(db, "testnet", channels);
            expect(channels.webhook.send).toHaveBeenCalledTimes(2);

            row = db
                .prepare("SELECT delivered, retry_count FROM alerts_fired WHERE id = ?")
                .get(alertFiredId) as { delivered: number; retry_count: number };
            expect(row.delivered).toBe(1);
        });
    });

    describe("Retry limits", () => {
        it("stops retrying after MAX_RETRY_COUNT failures", async () => {
            channels.webhook.send.mockRejectedValue(new Error("permanent failure"));
            const { alertFiredId } = seedAlert(db, { contractId: "CA" });

            for (let i = 0; i < MAX_RETRY_COUNT; i++) {
                await deliverPendingAlerts(db, "testnet", channels);
            }

            expect(channels.webhook.send).toHaveBeenCalledTimes(MAX_RETRY_COUNT);

            await deliverPendingAlerts(db, "testnet", channels);
            expect(channels.webhook.send).toHaveBeenCalledTimes(MAX_RETRY_COUNT);

            const row = db
                .prepare("SELECT retry_count, delivered FROM alerts_fired WHERE id = ?")
                .get(alertFiredId) as { retry_count: number; delivered: number };
            expect(row.retry_count).toBe(MAX_RETRY_COUNT);
            expect(row.delivered).toBe(0);
        });

        it("reports abandoned count in result", async () => {
            channels.webhook.send.mockRejectedValue(new Error("fail"));
            const { alertFiredId } = seedAlert(db, { contractId: "CA" });

            db.prepare("UPDATE alerts_fired SET retry_count = ? WHERE id = ?")
                .run(MAX_RETRY_COUNT - 1, alertFiredId);

            const result = await deliverPendingAlerts(db, "testnet", channels);
            expect(result.abandoned).toBe(1);
        });

        it("stops retrying after custom maxRetries limit", async () => {
            // Swap in a webhook definition with a lower retry cap for this test only.
            _resetRegistryForTesting();
            registerAlertChannel({
                name: "webhook",
                channel: channels.webhook,
                targetOption: "url",
                missingTargetError: "Error: --url is required when --type is webhook.",
                supportsSigning: true,
                maxRetries: 2,
            });

            channels.webhook.send.mockRejectedValue(new Error("fail"));
            const { alertFiredId } = seedAlert(db, { contractId: "CA" });

            // Run 2 cycles ΓÇö each should attempt delivery.
            for (let i = 0; i < 2; i++) {
                await deliverPendingAlerts(db, "testnet", channels);
            }
            expect(channels.webhook.send).toHaveBeenCalledTimes(2);

            // Next cycle should NOT attempt delivery ΓÇö alert excluded by retry cap of 2.
            await deliverPendingAlerts(db, "testnet", channels);
            expect(channels.webhook.send).toHaveBeenCalledTimes(2);

            const row = db
                .prepare("SELECT retry_count, delivered FROM alerts_fired WHERE id = ?")
                .get(alertFiredId) as { retry_count: number; delivered: number };
            expect(row.retry_count).toBe(2);
            expect(row.delivered).toBe(0);

            // Restore the real registry so later tests see normal built-in defaults.
            _resetRegistryForTesting();
            _resetBuiltinRegistrationForTesting();
            registerBuiltinChannels();
        });

        it("uses the global MAX_RETRY_COUNT when a channel has no maxRetries override", async () => {
            expect(getAlertChannel("webhook")?.maxRetries).toBeUndefined();
        });
    });

    describe("Error resilience / channel isolation", () => {
        it("never throws even if all deliveries fail", async () => {
            channels.webhook.send.mockRejectedValue(new Error("all down"));
            seedAlert(db, { contractId: "CA", entryKeyXdr: "key-a" });
            seedAlert(db, { contractId: "CB", entryKeyXdr: "key-b" });

            await expect(deliverPendingAlerts(db, "testnet", channels)).resolves.not.toThrow();
        });

        it("continues delivering subsequent alerts even if one fails", async () => {
            channels.webhook.send
                .mockRejectedValueOnce(new Error("first failed"))
                .mockResolvedValue(undefined);

            seedAlert(db, { contractId: "CA", entryKeyXdr: "key-a" });
            seedAlert(db, { contractId: "CB", entryKeyXdr: "key-b" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.webhook.send).toHaveBeenCalledTimes(2);
            expect(result.delivered).toBe(1);
            expect(result.failed).toBe(1);
        });

        it("failing webhook does not block slack delivery", async () => {
            channels.webhook.send.mockRejectedValue(new Error("webhook down"));

            seedAlert(db, { contractId: "CA", entryKeyXdr: "key-a", channelType: "webhook" });
            seedAlert(db, { contractId: "CB", entryKeyXdr: "key-b", channelType: "slack", channelTarget: "#alerts" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.webhook.send).toHaveBeenCalledTimes(1);
            expect(channels.slack.send).toHaveBeenCalledTimes(1);
            expect(result.delivered).toBe(1);
            expect(result.failed).toBe(1);
        });

        it("collects error messages for all failed deliveries", async () => {
            channels.webhook.send.mockRejectedValue(new Error("connection timeout"));
            seedAlert(db, { contractId: "CA", entryKeyXdr: "key-a" });
            seedAlert(db, { contractId: "CB", entryKeyXdr: "key-b" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(result.errors).toHaveLength(2);
            for (const err of result.errors) {
                expect(err).toContain("connection timeout");
            }
        });

        it("handles non-Error exceptions from delivery handlers", async () => {
            channels.webhook.send.mockRejectedValue("string error");
            seedAlert(db, { contractId: "CA" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(result.failed).toBe(1);
            expect(result.errors).toHaveLength(1);
        });

        it("reports unknown channel type as a failure without crashing", async () => {
            seedAlert(db, { contractId: "CA", channelType: "webhook" });
            const incompleteChannels = { slack: mockChannel() };

            const result = await deliverPendingAlerts(db, "testnet", incompleteChannels);

            expect(result.failed).toBe(1);
            expect(result.errors[0]).toContain("Unknown channel type: webhook");
        });
    });

    describe("Result counting", () => {
        it("counts attempted as total alerts processed regardless of outcome", async () => {
            channels.webhook.send
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error("fail"));

            seedAlert(db, { contractId: "CA", entryKeyXdr: "key-a" });
            seedAlert(db, { contractId: "CB", entryKeyXdr: "key-b" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(result.attempted).toBe(2);
            expect(result.delivered).toBe(1);
            expect(result.failed).toBe(1);
        });

        it("counts all successful deliveries across channels", async () => {
            seedAlert(db, { contractId: "CA", entryKeyXdr: "key-a", channelType: "webhook" });
            seedAlert(db, { contractId: "CB", entryKeyXdr: "key-b", channelType: "slack", channelTarget: "#alerts" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(result.attempted).toBe(2);
            expect(result.delivered).toBe(2);
            expect(result.failed).toBe(0);
        });
    });

    describe("Network isolation", () => {
        it("only delivers alerts for the specified network", async () => {
            seedAlert(db, { contractId: "TESTNET_C", network: "testnet" });
            seedAlert(db, { contractId: "MAINNET_C", network: "mainnet" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.webhook.send).toHaveBeenCalledTimes(1);
            expect(result.attempted).toBe(1);
        });

        it("delivers nothing when no alerts exist for the given network", async () => {
            seedAlert(db, { contractId: "MAINNET_C", network: "mainnet" });

            const result = await deliverPendingAlerts(db, "testnet", channels);

            expect(channels.webhook.send).not.toHaveBeenCalled();
            expect(result.attempted).toBe(0);
        });
    });

    describe("Payload correctness", () => {
        it("event timestamp is a valid ISO 8601 string", async () => {
            seedAlert(db, { contractId: "CA" });

            await deliverPendingAlerts(db, "testnet", channels);

            const [, event] = channels.webhook.send.mock.calls[0]!;
            expect(() => new Date(event.timestamp)).not.toThrow();
            expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
        });

        it("event entry.keyXdr matches the stored entry_key_xdr", async () => {
            seedAlert(db, { contractId: "CA", entryKeyXdr: "special-xdr-key" });

            await deliverPendingAlerts(db, "testnet", channels);

            const [, event] = channels.webhook.send.mock.calls[0]!;
            expect(event.entry.keyXdr).toBe("special-xdr-key");
        });

        it("event firedAtLedger matches the stored fired_at_ledger", async () => {
            seedAlert(db, { contractId: "CA" });

            await deliverPendingAlerts(db, "testnet", channels);

            const [, event] = channels.webhook.send.mock.calls[0]!;
            expect(event.firedAtLedger).toBe(2_500_000);
        });

        it("approximateTimeRemaining is a non-empty string", async () => {
            seedAlert(db, { contractId: "CA", ttlAtFire: 50_000 });

            await deliverPendingAlerts(db, "testnet", channels);

            const [, event] = channels.webhook.send.mock.calls[0]!;
            expect(typeof event.threshold.approximateTimeRemaining).toBe("string");
            expect(event.threshold.approximateTimeRemaining.length).toBeGreaterThan(0);
        });

        it("event includes severity field", async () => {
            seedAlert(db, { contractId: "CA", ttlAtFire: 1_000 });

            await deliverPendingAlerts(db, "testnet", channels);

            const [, event] = channels.webhook.send.mock.calls[0]!;
            expect(event.severity).toBe("critical");
        });
    });
});

describe("Quiet hours", () => {
    /**
     * Helper: build a UTC Date whose time-of-day in `timezone` is exactly `hhmm`.
     * e.g. localTimeInTz("14:00", "America/New_York") returns a UTC Date that,
     * when converted to Eastern Time, reads 14:00.
     */
    function utcAtLocalTime(hhmm: string, timezone: string): Date {
        const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
        // Find the UTC offset for the given timezone at an arbitrary date (today).
        // We iterate by constructing a candidate UTC time and checking what local
        // hour it maps to. A simple closed-form approach: use Intl to find offset.
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "numeric",
            minute: "numeric",
            hour12: false,
        });
        // Get today's date parts in the target tz.
        const dateParts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(now);
        const year = parseInt(dateParts.find((p) => p.type === "year")!.value, 10);
        const month = parseInt(dateParts.find((p) => p.type === "month")!.value, 10) - 1;
        const day = parseInt(dateParts.find((p) => p.type === "day")!.value, 10);

        // Construct a UTC date that represents today at HH:MM in the given timezone.
        // Strategy: start from midnight UTC of today, then adjust.
        // The simplest portable approach: binary-search or offset-based.
        // For test purposes we use a well-known fixed timezone offset.
        // We construct the local midnight, then add hh:mm hours.
        // Use Date constructor with explicit parts and offset discovered via Intl.
        const candidate = new Date(Date.UTC(year, month, day, hh, mm, 0, 0));
        // Determine the offset: what local time does `candidate` map to in timezone?
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(candidate);
        const localHour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
        const localMin = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
        // Offset in minutes between UTC and local time
        const offsetMinutes = (hh * 60 + mm) - (localHour * 60 + localMin);
        // Adjust the candidate by the offset
        return new Date(candidate.getTime() + offsetMinutes * 60_000);
    }

    let db: ReturnType<typeof getDatabaseForTesting>;
    let channels: Record<string, ReturnType<typeof mockChannel>>;

    function mockChannel() {
        return { send: vi.fn().mockResolvedValue(undefined) };
    }

    beforeEach(() => {
        db = getDatabaseForTesting();
        channels = { webhook: mockChannel(), slack: mockChannel() };
    });

    it("delivers an alert whose config has NO quiet hours configured", async () => {
        // Baseline: no quiet hours ΓåÆ behaves exactly as before.
        seedAlert(db, {
            contractId: "CA",
            // No quietHoursStart / quietHoursEnd / quietHoursTimezone
        });

        const result = await deliverPendingAlerts(db, "testnet", channels);

        expect(channels.webhook.send).toHaveBeenCalledTimes(1);
        expect(result.delivered).toBe(1);
        expect(result.attempted).toBe(1);
    });

    it("skips (keeps pending) an alert when the current time is inside the quiet window", async () => {
        // Use UTC timezone so we don't need offset arithmetic in the test.
        // Set the quiet window to cover a large range (00:00ΓÇô23:59) in UTC
        // so that whatever time the test runs it will be inside the window.
        seedAlert(db, {
            contractId: "CA",
            quietHoursStart: "00:00",
            quietHoursEnd: "23:59",
            quietHoursTimezone: "UTC",
        });

        const result = await deliverPendingAlerts(db, "testnet", channels);

        // Must NOT have been sent.
        expect(channels.webhook.send).not.toHaveBeenCalled();
        // The alert must NOT be marked delivered.
        const row = db
            .prepare("SELECT delivered FROM alerts_fired WHERE id = 1")
            .get() as { delivered: number };
        expect(row.delivered).toBe(0);
        // attempted is still incremented, but delivered is 0.
        expect(result.attempted).toBe(1);
        expect(result.delivered).toBe(0);
    });

    it("delivers an alert when the current time is OUTSIDE the quiet window", async () => {
        // Use a past-ended quiet window: from 00:00 to 00:01.
        // At any normal test run time (unless tests run exactly at midnight UTC!)
        // the current UTC time will be after 00:01.
        // To make the test deterministic, we set up a window that ended in the past.
        // We use the fixed string "00:00"-"00:01" in UTC ΓÇö unless the test runs
        // at exactly 00:00 UTC, the current time is outside this window.
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMin = now.getUTCMinutes();
        const currentMinutes = utcHour * 60 + utcMin;

        // Pick a window that clearly doesn't include now.
        // We place it in the middle of the night (01:00-02:00).
        // If we happen to run between 01:00-02:00 UTC, shift to 03:00-04:00.
        let windowStart = "01:00";
        let windowEnd = "02:00";
        if (currentMinutes >= 60 && currentMinutes < 120) {
            windowStart = "03:00";
            windowEnd = "04:00";
        }

        seedAlert(db, {
            contractId: "CA",
            quietHoursStart: windowStart,
            quietHoursEnd: windowEnd,
            quietHoursTimezone: "UTC",
        });

        const result = await deliverPendingAlerts(db, "testnet", channels);

        expect(channels.webhook.send).toHaveBeenCalledTimes(1);
        expect(result.delivered).toBe(1);
    });

    it("handles overnight quiet windows (start > end, e.g. 22:00ΓÇô06:00)", async () => {
        // 22:00ΓÇô06:00 UTC covers midnight. Since tests could run at any time,
        // we test both inside and outside with two separate assertions.
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMin = now.getUTCMinutes();
        const currentMinutes = utcHour * 60 + utcMin;

        // Current time is in 22:00ΓÇô23:59 or 00:00ΓÇô05:59 ΓåÆ inside window.
        const insideWindow =
            currentMinutes >= 22 * 60 || currentMinutes < 6 * 60;

        seedAlert(db, {
            contractId: "CA",
            quietHoursStart: "22:00",
            quietHoursEnd: "06:00",
            quietHoursTimezone: "UTC",
        });

        const result = await deliverPendingAlerts(db, "testnet", channels);

        if (insideWindow) {
            expect(channels.webhook.send).not.toHaveBeenCalled();
            expect(result.delivered).toBe(0);
        } else {
            expect(channels.webhook.send).toHaveBeenCalledTimes(1);
            expect(result.delivered).toBe(1);
        }
    });

    it("delivers after a quiet window that was previously active (skipped alert remains pending)", async () => {
        // Simulate that on the FIRST delivery cycle the window is active (skip),
        // and on the SECOND cycle it is inactive (deliver).
        // We achieve this by using the full-day window for the first call
        // and then directly testing that the alert row is still pending.
        seedAlert(db, {
            contractId: "CA",
            quietHoursStart: "00:00",
            quietHoursEnd: "23:59",
            quietHoursTimezone: "UTC",
        });

        // First cycle: inside window ΓÇö skipped.
        await deliverPendingAlerts(db, "testnet", channels);
        expect(channels.webhook.send).not.toHaveBeenCalled();

        // Verify the alert is still in the pending queue (not marked delivered, retry_count unchanged).
        const row = db
            .prepare("SELECT delivered, retry_count FROM alerts_fired WHERE id = 1")
            .get() as { delivered: number; retry_count: number };
        expect(row.delivered).toBe(0);
        expect(row.retry_count).toBe(0); // retry_count must NOT be incremented for quiet-hour skips

        // Now update the config to have NO quiet window (simulate window closed).
        db.prepare(
            "UPDATE alert_configs SET quiet_hours_start = NULL, quiet_hours_end = NULL, quiet_hours_timezone = NULL WHERE contract_id = 'CA'"
        ).run();

        // Second cycle: outside window ΓÇö delivered.
        const result = await deliverPendingAlerts(db, "testnet", channels);
        expect(channels.webhook.send).toHaveBeenCalledTimes(1);
        expect(result.delivered).toBe(1);
    });

    it("does not increment retry_count when delivery is skipped due to quiet hours", async () => {
        seedAlert(db, {
            contractId: "CA",
            quietHoursStart: "00:00",
            quietHoursEnd: "23:59",
            quietHoursTimezone: "UTC",
        });

        // Run multiple cycles while inside the window.
        for (let i = 0; i < 3; i++) {
            await deliverPendingAlerts(db, "testnet", channels);
        }

        const row = db
            .prepare("SELECT retry_count, delivered FROM alerts_fired WHERE id = 1")
            .get() as { retry_count: number; delivered: number };

        // retry_count must stay at 0 ΓÇö quiet-hour skips are NOT failures.
        expect(row.retry_count).toBe(0);
        expect(row.delivered).toBe(0);
    });

    it("a second alert without quiet hours is delivered even when another alert is skipped", async () => {
        // Alert A: has quiet window covering all day ΓåÆ skipped.
        seedAlert(db, {
            contractId: "CA",
            entryKeyXdr: "key-a",
            quietHoursStart: "00:00",
            quietHoursEnd: "23:59",
            quietHoursTimezone: "UTC",
        });

        // Alert B: no quiet window ΓåÆ delivered.
        seedAlert(db, {
            contractId: "CB",
            entryKeyXdr: "key-b",
        });

        const result = await deliverPendingAlerts(db, "testnet", channels);

        // Only alert B delivered.
        expect(channels.webhook.send).toHaveBeenCalledTimes(1);
        expect(result.delivered).toBe(1);
        expect(result.attempted).toBe(2);
    });
});
