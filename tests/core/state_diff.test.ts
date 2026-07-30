/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import {
    insertContract,
    upsertEntry,
    getEntriesForContract,
    insertStateSnapshot,
    getLatestSnapshot,
    getStateChanges,
} from "../../src/db/repositories";
import * as stateDiff from "../../src/core/state_diff";
import type { StateDiffResult } from "../../src/core/state_diff";

describe("State Diff Engine", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    afterEach(() => {
        db.close();
    });

    // =========================================================================
    // 1. computeValueHash
    // =========================================================================
    describe("computeValueHash", () => {
        it("returns a consistent SHA-256 hex string for identical inputs", () => {
            const hash1 = stateDiff.computeValueHash("AAAAAQ==");
            const hash2 = stateDiff.computeValueHash("AAAAAQ==");
            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[a-f0-9]{64}$/);
        });

        it("returns different hashes for different inputs", () => {
            const hash1 = stateDiff.computeValueHash("AAAAAQ==");
            const hash2 = stateDiff.computeValueHash("AAAAAg==");
            expect(hash1).not.toBe(hash2);
        });

        it("handles empty string input", () => {
            const hash = stateDiff.computeValueHash("");
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    // =========================================================================
    // 2. diffStateValues
    // =========================================================================
    describe("diffStateValues", () => {
        it("returns null and does not hash when both values are null", () => {
            const spy = vi.spyOn(stateDiff, "computeValueHash");
            const result = stateDiff.diffStateValues(null, null);

            expect(result).toBeNull();
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("returns null and does not hash when both values are identical", () => {
            const spy = vi.spyOn(stateDiff, "computeValueHash");
            const result = stateDiff.diffStateValues("AAAAAQ==", "AAAAAQ==");

            expect(result).toBeNull();
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("returns 'created' when old value is null and hashes only the new value", () => {
            const spy = vi.spyOn(stateDiff, "computeValueHash");
            const result = stateDiff.diffStateValues(null, "AAAAAQ==");

            expect(result).not.toBeNull();
            expect(result!.diffType).toBe("created");
            expect(result!.oldValueXdr).toBeNull();
            expect(result!.newValueXdr).toBe("AAAAAQ==");
            expect(result!.oldHash).toBeNull();
            expect(result!.newHash).toBe(stateDiff.computeValueHash("AAAAAQ=="));
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith("AAAAAQ==");
            spy.mockRestore();
        });

        it("returns 'deleted' when new value is null and hashes only the old value", () => {
            const spy = vi.spyOn(stateDiff, "computeValueHash");
            const result = stateDiff.diffStateValues("AAAAAQ==", null);

            expect(result).not.toBeNull();
            expect(result!.diffType).toBe("deleted");
            expect(result!.oldValueXdr).toBe("AAAAAQ==");
            expect(result!.newValueXdr).toBeNull();
            expect(result!.oldHash).toBe(stateDiff.computeValueHash("AAAAAQ=="));
            expect(result!.newHash).toBeNull();
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith("AAAAAQ==");
            spy.mockRestore();
        });

        it("returns 'updated' when both values are different and hashes both values", () => {
            const spy = vi.spyOn(stateDiff, "computeValueHash");
            const result = stateDiff.diffStateValues("AAAAAQ==", "AAAAAg==");

            expect(result).not.toBeNull();
            expect(result!.diffType).toBe("updated");
            expect(result!.oldValueXdr).toBe("AAAAAQ==");
            expect(result!.newValueXdr).toBe("AAAAAg==");
            expect(result!.oldHash).toBe(stateDiff.computeValueHash("AAAAAQ=="));
            expect(result!.newHash).toBe(stateDiff.computeValueHash("AAAAAg=="));
            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls).toEqual([["AAAAAQ=="], ["AAAAAg=="]]);
            spy.mockRestore();
        });
    });

    // =========================================================================
    // 3. processStateDiff — integration with DB
    // =========================================================================
    describe("processStateDiff", () => {
        let entryId: number;

        beforeEach(() => {
            insertContract(db, { id: "C1", network: "testnet" });
            upsertEntry(db, {
                contract_id: "C1",
                entry_key_xdr: "key-xdr-1",
                entry_type: "persistent",
            });
            entryId = getEntriesForContract(db, "C1")[0]!.id;
        });

        it("creates a snapshot and 'created' change on first-ever value", () => {
            const result = stateDiff.processStateDiff(db, entryId, "AAAAAQ==", 1000);

            expect(result).not.toBeNull();
            expect(result!.diffType).toBe("created");

            // Verify snapshot was saved
            const snapshot = getLatestSnapshot(db, entryId);
            expect(snapshot).toBeDefined();
            expect(snapshot!.value_xdr).toBe("AAAAAQ==");
            expect(snapshot!.snapshot_ledger).toBe(1000);

            // Verify state change was logged
            const changes = getStateChanges(db, entryId);
            expect(changes).toHaveLength(1);
            expect(changes[0]!.diff_type).toBe("created");
            expect(changes[0]!.detected_at_ledger).toBe(1000);
        });

        it("creates snapshot and 'updated' change when value changes", () => {
            // First call — initial value
            stateDiff.processStateDiff(db, entryId, "AAAAAQ==", 1000);

            // Second call — different value
            const result = stateDiff.processStateDiff(db, entryId, "AAAAAg==", 1001);

            expect(result).not.toBeNull();
            expect(result!.diffType).toBe("updated");
            expect(result!.oldValueXdr).toBe("AAAAAQ==");
            expect(result!.newValueXdr).toBe("AAAAAg==");

            // Verify two snapshots exist
            const changes = getStateChanges(db, entryId);
            expect(changes).toHaveLength(2);

            // Most recent change should be 'updated'
            expect(changes[0]!.diff_type).toBe("updated");
            expect(changes[0]!.old_snapshot_id).toBeDefined();
            expect(changes[0]!.new_snapshot_id).toBeDefined();
        });

        it("does NOT create records when hash is unchanged (storage optimization)", () => {
            stateDiff.processStateDiff(db, entryId, "AAAAAQ==", 1000);

            // Same value again
            const result = stateDiff.processStateDiff(db, entryId, "AAAAAQ==", 1001);

            expect(result).toBeNull();

            const snapshotCount = db.prepare(
                "SELECT COUNT(*) as count FROM state_snapshots WHERE contract_entry_id = ?"
            ).get(entryId).count as number;
            expect(snapshotCount).toBe(1);

            const changes = getStateChanges(db, entryId);
            expect(changes).toHaveLength(1);
        });

        it("links updated state changes to the prior snapshot via old_snapshot_id", () => {
            stateDiff.processStateDiff(db, entryId, "AAAAAQ==", 1000);
            const firstSnapshot = getLatestSnapshot(db, entryId);
            expect(firstSnapshot).toBeDefined();

            stateDiff.processStateDiff(db, entryId, "AAAAAg==", 1001);
            const changes = getStateChanges(db, entryId);
            expect(changes).toHaveLength(2);

            const updatedChange = changes[0]!;
            expect(updatedChange.diff_type).toBe("updated");
            expect(updatedChange.old_snapshot_id).toBe(firstSnapshot!.id);
            expect(updatedChange.new_snapshot_id).toBeGreaterThan(0);
        });

        it("correctly handles multiple sequential value changes", () => {
            stateDiff.processStateDiff(db, entryId, "val1", 1000);
            stateDiff.processStateDiff(db, entryId, "val2", 1001);
            stateDiff.processStateDiff(db, entryId, "val3", 1002);

            const changes = getStateChanges(db, entryId);
            expect(changes).toHaveLength(3);
            // Ordered DESC by detected_at_ledger
            expect(changes[0]!.diff_type).toBe("updated");
            expect(changes[1]!.diff_type).toBe("updated");
            expect(changes[2]!.diff_type).toBe("created");
        });

        it("handles empty XDR string as a valid value", () => {
            const result = stateDiff.processStateDiff(db, entryId, "", 1000);
            expect(result).not.toBeNull();
            expect(result!.diffType).toBe("created");

            const snapshot = getLatestSnapshot(db, entryId);
            expect(snapshot!.value_xdr).toBe("");
        });

        it("diff_json in state_change contains old and new value info", () => {
            stateDiff.processStateDiff(db, entryId, "old-xdr", 1000);
            stateDiff.processStateDiff(db, entryId, "new-xdr", 1001);

            const changes = getStateChanges(db, entryId);
            const updatedChange = changes[0]!;
            const diffJson = JSON.parse(updatedChange.diff_json);

            expect(diffJson).toHaveProperty("oldValueXdr", "old-xdr");
            expect(diffJson).toHaveProperty("newValueXdr", "new-xdr");
            expect(diffJson).toHaveProperty("diffType", "updated");
        });

        it("stores correct snapshot references in state_change", () => {
            stateDiff.processStateDiff(db, entryId, "val-a", 1000);
            stateDiff.processStateDiff(db, entryId, "val-b", 1001);

            const changes = getStateChanges(db, entryId);
            const updatedChange = changes[0]!;

            // Both snapshot IDs should be set
            expect(updatedChange.old_snapshot_id).toBeGreaterThan(0);
            expect(updatedChange.new_snapshot_id).toBeGreaterThan(0);
            expect(updatedChange.old_snapshot_id).not.toBe(updatedChange.new_snapshot_id);
        });

        it("'created' change has null old_snapshot_id", () => {
            stateDiff.processStateDiff(db, entryId, "val-a", 1000);

            const changes = getStateChanges(db, entryId);
            expect(changes[0]!.old_snapshot_id).toBeNull();
            expect(changes[0]!.new_snapshot_id).toBeGreaterThan(0);
        });
    });
});
