import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { 
    insertContract, 
    upsertExtensionPolicy, 
    upsertEntry, 
    upsertBudget, 
    getBudget 
} from '../../src/db/repositories';

// ─── Mock RPC client (same pattern as extension.test.ts) ────────────────────
// Module-level vi.fn() handles are captured outside the factory so that
// beforeEach can reconfigure them without losing the mock binding.
// Using the .js extension mirrors how the source file imports the module.

const mockGetCurrentLedger = vi.fn();
const mockSimulateExtension = vi.fn();
const mockSubmitExtension = vi.fn();
const mockGetEntryTTLs = vi.fn();

vi.mock('../../src/rpc/client.js', () => {
    return {
        StellarRpcClient: class MockStellarRpcClient {
            constructor() {}
            getCurrentLedger = mockGetCurrentLedger;
            simulateExtension = mockSimulateExtension;
            submitExtension = mockSubmitExtension;
            getEntryTTLs = mockGetEntryTTLs;
        },
    };
});

// Import the module under test AFTER the mock is hoisted so that the dynamic
// import inside extension.ts also picks up the mock (avoids v8-coverage breakage).
const { runAutoExtensions } = await import('../../src/core/extension.js');

// A real valid Stellar secret key (deterministic from all-\x01 seed) used as a
// test fixture.  The env: prefix routes through resolveSecretKey so the value
// is read from process.env at runtime, and Keypair.fromSecret() receives a key
// with a correct checksum — avoiding breakage when v8 coverage causes dynamic
// imports to bypass vi.mock() hoisting for @stellar/stellar-sdk.
const TEST_SECRET = 'SAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC5MY';
const DUMMY_SOURCE = 'env:BUDGET_TEST_SECRET_KEY';

describe('Budget Enforcement', () => {
    let db: Database.Database;

    beforeEach(() => {
        // Make the secret key available to resolveSecretKey via env
        process.env['BUDGET_TEST_SECRET_KEY'] = TEST_SECRET;

        db = new Database(':memory:');
        const schema = fs.readFileSync(path.resolve(__dirname, '../../src/db/schema.sql'), 'utf8');
        db.exec(schema);

        insertContract(db, { id: 'contract_1', network: 'testnet' });
        upsertExtensionPolicy(db, {
            contract_id: 'contract_1',
            enabled: true,
            target_ttl_ledgers: 50000,
            extend_when_below_ledgers: 20000,
            keypair_source: DUMMY_SOURCE
        });
        upsertEntry(db, {
            contract_id: 'contract_1',
            entry_key_xdr: 'AAAA',
            entry_type: 'instance',
            live_until_ledger: 1500 // 500 remaining (1500 - 1000)
        });

        // Configure default mock responses — individual tests can override
        mockGetCurrentLedger.mockResolvedValue(1000);
        mockSimulateExtension.mockResolvedValue({
            success: true,
            minResourceFee: 15000000 // 1.5 XLM in stroops
        });
        mockSubmitExtension.mockResolvedValue({
            success: true,
            txHash: '0x123',
            ledger: 1001,
            cpuInsns: 100,
            memBytes: 100
        });
        mockGetEntryTTLs.mockResolvedValue({
            latestLedger: 1001,
            entries: [{
                entryKeyXdr: 'AAAA',
                remainingTTL: 50000,
                liveUntilLedgerSeq: 51001,
                lastModifiedLedgerSeq: 1001
            }]
        });
    });

    afterEach(() => {
        delete process.env['BUDGET_TEST_SECRET_KEY'];
        vi.clearAllMocks();
    });

    it('Extensions are skipped when budget limit is crossed', async () => {
        // Set limit to 1.0 XLM. Simulation costs 1.5 XLM.
        const currentCycle = new Date().toISOString().slice(0, 7);
        upsertBudget(db, {
            contract_id: 'contract_1',
            limit_xlm: 1.0,
            billing_cycle: currentCycle
        });

        const result = await runAutoExtensions(db, 'testnet');
        
        expect(result.contractsChecked).toBe(1);
        expect(result.contractsExtended).toBe(0);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('budget limit exceeded');
        
        const budget = getBudget(db, 'contract_1', currentCycle);
        expect(budget?.spent_xlm).toBe(0);
    });

    it('Database records spend history correctly when within budget', async () => {
        // Set limit to 2.0 XLM. Simulation costs 1.5 XLM.
        const currentCycle = new Date().toISOString().slice(0, 7);
        upsertBudget(db, {
            contract_id: 'contract_1',
            limit_xlm: 2.0,
            billing_cycle: currentCycle
        });

        const result = await runAutoExtensions(db, 'testnet');
        
        expect(result.contractsChecked).toBe(1);
        expect(result.contractsExtended).toBe(1);
        
        const budget = getBudget(db, 'contract_1', currentCycle);
        // spent_xlm should increase by 1.5
        expect(budget?.spent_xlm).toBe(1.5);
    });

    // ── Shared budget pools (#407) ─────────────────────────────────────────

    it('blocks every contract in a pool once their combined spend reaches the cap', async () => {
        insertContract(db, { id: 'contract_2', network: 'testnet' });
        upsertExtensionPolicy(db, { contract_id: 'contract_2', enabled: true, target_ttl_ledgers: 50000, extend_when_below_ledgers: 20000, keypair_source: DUMMY_SOURCE });
        upsertEntry(db, { contract_id: 'contract_2', entry_key_xdr: 'BBBB', entry_type: 'instance', live_until_ledger: 1500 });
        const currentCycle = new Date().toISOString().slice(0, 7);
        const pool = db.prepare(`INSERT INTO shared_budget_pools (name, monthly_limit_xlm, billing_cycle, spent_xlm) VALUES (?, ?, ?, ?)`)
            .run('product-line', 100, currentCycle, 100);
        const assign = db.prepare(`INSERT INTO shared_budget_pool_contracts (pool_id, contract_id) VALUES (?, ?)`);
        assign.run(pool.lastInsertRowid, 'contract_1');
        assign.run(pool.lastInsertRowid, 'contract_2');
        upsertBudget(db, { contract_id: 'contract_1', limit_xlm: 1000, billing_cycle: currentCycle });
        upsertBudget(db, { contract_id: 'contract_2', limit_xlm: 1000, billing_cycle: currentCycle });

        const result = await runAutoExtensions(db, 'testnet');

        expect(result.contractsChecked).toBe(2);
        expect(result.contractsExtended).toBe(0);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.every(error => error.includes('shared budget pool "product-line" limit exceeded'))).toBe(true);
        expect(getBudget(db, 'contract_1', currentCycle)?.spent_xlm).toBe(0);
        expect(getBudget(db, 'contract_2', currentCycle)?.spent_xlm).toBe(0);
    });

    it('records successful extension spend against the shared pool only', async () => {
        const currentCycle = new Date().toISOString().slice(0, 7);
        const pool = db.prepare(`INSERT INTO shared_budget_pools (name, monthly_limit_xlm, billing_cycle) VALUES (?, ?, ?)`)
            .run('product-line', 100, currentCycle);
        db.prepare(`INSERT INTO shared_budget_pool_contracts (pool_id, contract_id) VALUES (?, ?)`)
            .run(pool.lastInsertRowid, 'contract_1');
        upsertBudget(db, { contract_id: 'contract_1', limit_xlm: 1000, billing_cycle: currentCycle });

        const result = await runAutoExtensions(db, 'testnet');

        expect(result.contractsExtended).toBe(1);
        const sharedPool = db.prepare(`SELECT spent_xlm FROM shared_budget_pools WHERE id = ?`)
            .get(pool.lastInsertRowid) as { spent_xlm: number };
        expect(sharedPool.spent_xlm).toBe(1.5);
        expect(getBudget(db, 'contract_1', currentCycle)?.spent_xlm).toBe(0);
    });

    it('resets stale pool spend when a new billing cycle starts', async () => {
        const currentCycle = new Date().toISOString().slice(0, 7);
        const pool = db.prepare(`INSERT INTO shared_budget_pools (name, monthly_limit_xlm, billing_cycle, spent_xlm) VALUES (?, ?, ?, ?)`)
            .run('product-line', 2, '2000-01', 2);
        db.prepare(`INSERT INTO shared_budget_pool_contracts (pool_id, contract_id) VALUES (?, ?)`)
            .run(pool.lastInsertRowid, 'contract_1');

        const result = await runAutoExtensions(db, 'testnet');

        expect(result.contractsExtended).toBe(1);
        const sharedPool = db.prepare(`SELECT billing_cycle, spent_xlm FROM shared_budget_pools WHERE id = ?`)
            .get(pool.lastInsertRowid) as { billing_cycle: string; spent_xlm: number };
        expect(sharedPool).toEqual({ billing_cycle: currentCycle, spent_xlm: 1.5 });
    });
});
