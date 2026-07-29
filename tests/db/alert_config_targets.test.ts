import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import {
    insertContract,
    upsertEntry,
    insertAlertConfig,
    AlertConfigTarget,
    getAlertConfigTargets,
    addTargetToAlertConfig,
    removeTargetFromAlertConfig,
    recordAlertFired,
    getUndeliveredAlerts,
    MAX_RETRY_COUNT
} from "../../src/db/repositories.js";

describe("AlertConfig Targets Fan-out", () => {
    let db: Database.Database;
    const contractId = "C_TEST_FANOUT";
    const entryXdr = "AAAAE_ENTRY";
    let entryId: number;
    let alertConfigId: number;

    beforeEach(() => {
        db = getDatabaseForTesting();
        
        insertContract(db, { id: contractId, network: "testnet" });
        upsertEntry(db, {
            contract_id: contractId,
            entry_key_xdr: entryXdr,
            entry_type: "instance",
            live_until_ledger: 1000,
            last_modified_ledger: 100,
            discovery_source: "deterministic"
        });

        const entry = db.prepare("SELECT id FROM contract_entries WHERE contract_id = ?").get(contractId) as { id: number };
        entryId = entry.id;

        alertConfigId = insertAlertConfig(db, {
            contract_id: contractId,
            channel_type: "webhook",
            channel_target: "https://example.com/primary",
            threshold_ledgers: 500,
            webhook_secret: null
        });
    });

    afterEach(() => {
        db.close();
    });

    it("should allow adding multiple targets to an alert_config", () => {
        addTargetToAlertConfig(db, alertConfigId, "slack", "C12345");
        addTargetToAlertConfig(db, alertConfigId, "pagerduty", "pd-routing-key");

        const targets = getAlertConfigTargets(db, alertConfigId);
        expect(targets).toHaveLength(2);
        
        const slackTarget = targets.find(t => t.channel_type === "slack");
        expect(slackTarget).toBeDefined();
        expect(slackTarget?.channel_target).toBe("C12345");

        const pdTarget = targets.find(t => t.channel_type === "pagerduty");
        expect(pdTarget).toBeDefined();
        expect(pdTarget?.channel_target).toBe("pd-routing-key");
    });

    it("should enqueue a delivery attempt per target when recording alert fired", () => {
        // Enqueue three targets total: 1 primary (in alert_configs) + 2 additional
        addTargetToAlertConfig(db, alertConfigId, "slack", "C12345");
        addTargetToAlertConfig(db, alertConfigId, "pagerduty", "pd-key");

        // Simulate threshold crossed, enqueueing delivery per target.
        // We will test if recordAlertFired can be called once per target
        recordAlertFired(db, {
            alert_config_id: alertConfigId,
            contract_entry_id: entryId,
            fired_at_ledger: 2000,
            ttl_at_fire: 400,
            channel_type: "webhook",
            channel_target: "https://example.com/primary"
        });

        recordAlertFired(db, {
            alert_config_id: alertConfigId,
            contract_entry_id: entryId,
            fired_at_ledger: 2000,
            ttl_at_fire: 400,
            channel_type: "slack",
            channel_target: "C12345"
        });

        recordAlertFired(db, {
            alert_config_id: alertConfigId,
            contract_entry_id: entryId,
            fired_at_ledger: 2000,
            ttl_at_fire: 400,
            channel_type: "pagerduty",
            channel_target: "pd-key"
        });

        const undelivered = getUndeliveredAlerts(db, "testnet");
        expect(undelivered).toHaveLength(3);

        const types = undelivered.map(u => u.channelType).sort();
        expect(types).toEqual(["pagerduty", "slack", "webhook"]);
    });

    it("should fall back to primary target if no explicit channel type/target provided to recordAlertFired", () => {
        recordAlertFired(db, {
            alert_config_id: alertConfigId,
            contract_entry_id: entryId,
            fired_at_ledger: 2000,
            ttl_at_fire: 400,
        });

        const undelivered = getUndeliveredAlerts(db, "testnet");
        expect(undelivered).toHaveLength(1);
        expect(undelivered[0].channelType).toBe("webhook");
        expect(undelivered[0].channelTarget).toBe("https://example.com/primary");
    });
});
