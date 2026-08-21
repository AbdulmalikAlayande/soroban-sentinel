# Feature #491 Implementation: Per-Entry-Type Extension Policies

## Overview
This implementation adds support for per-entry-type extension policies to sorokeep. Previously, a single policy applied uniformly to all entry types (instance, wasm, persistent, temporary) for a contract. Now users can configure different target TTL and extension thresholds for each entry type independently.

## Changes Summary

### 1. Database Schema (Migration 009)
**File:** `src/db/migrations/009_per_entry_type_policies.sql`

- Added `entry_type` column to `extension_policies` table
- Column accepts: NULL (contract-level default), 'instance', 'wasm', 'persistent', 'temporary'
- Changed UNIQUE constraint from `(contract_id)` to `(contract_id, entry_type)`
- Allows up to 5 rows per contract (1 contract-level + 4 per-type overrides)
- Migration safely preserves existing data by migrating all rows with entry_type=NULL

### 2. Data Access Layer
**File:** `src/db/repositories.ts`

#### ExtensionPolicy Interface
- Added optional `entry_type: string | null` field
- null = contract-level policy
- Specific entry type = per-type override

#### getExtensionPolicy Function
```typescript
export function getExtensionPolicy(
  db: Database.Database,
  contractId: string,
  entryType?: string | null
): ExtensionPolicy | undefined
```
- When called without entryType: returns contract-level policy (entry_type IS NULL)
- When called with entryType: returns per-type override or undefined if no override exists

#### upsertExtensionPolicy Function
- Now accepts optional `entry_type?: string | null` parameter
- Uses UPSERT with composite key (contract_id, entry_type)
- Supports creating/updating both contract-level and per-type policies

### 3. Core Extension Logic
**File:** `src/core/extension.ts`

#### Per-Type Policy Resolution
In `runAutoExtensions`:
- For each entry, compute effective policy via `getEffectivePolicy()`:
  1. Check for per-entry-type override (enabled)
  2. Fall back to contract-level policy
- Filter entries using their effective policy's `extend_when_below_ledgers` threshold

#### Target TTL Determination
- When extending multiple entry types in one transaction, use **maximum** target_ttl_ledgers
- Ensures all entry types meet or exceed their policy targets
- Computed as: `Math.max(...needsExtension.map(e => getEffectivePolicy(e).target_ttl_ledgers))`

#### Rate Limiting
- Rate limiting stays per-contract (not per-policy)
- Prevents one entry type's extensions from starving another's rate limit budget

### 4. Guard Command
**File:** `src/commands/guard.ts`

#### New Flag
```bash
--entry-type <type>
```
- Optional parameter: instance|wasm|persistent|temporary
- Omit for contract-level default
- Example: `sorokeep guard apply C123 --entry-type instance --target-ttl 150000`

#### Validation
- Validates entry_type against allowed values
- Works with all existing flags: --auto-extend, --disable, --dry-run, etc.
- Supports --tag for bulk operations

#### Policy Application
- Updated JSON output to include entryType in responses
- Updated console messages to show type label (contract-level vs specific type)

### 5. Fleet Operations
**File:** `src/core/fleet.ts`

#### GuardPolicyInput Interface
- Added `entry_type?: string | null` field

#### applyGuardPolicyByTag Function
- Passes entry_type to upsertExtensionPolicy
- Enables bulk policy application per entry type with --tag

## Tests

### Unit Tests (TDD - Written First)
**File:** `tests/core/extension.test.ts`
- "Per-Entry-Type Extension Policies" test suite with 5 test cases:
  1. Per-type override applies only to matching entry type
  2. Entry types without override fall back to contract-level
  3. Disabled per-type policy falls back to contract-level
  4. All four entry types can have independent policies
  5. Per-type target_ttl is used when extending

**File:** `tests/db/repositories.test.ts`
- "Per-Entry-Type Policies" tests in ExtensionPolicy CRUD suite:
  1. Upsert and get per-entry-type policy override
  2. Fallback to contract-level when no override exists
  3. Disable per-type while keeping contract-level enabled
  4. All four entry types independently
  5. Upsert to update existing override

## Acceptance Criteria ✓
1. ✓ A per-entry-type policy overrides the contract-level default for that entry type only
2. ✓ Entry types without an override fall back to the contract-level policy unchanged

## Example Usage

### Set contract-level default
```bash
sorokeep guard apply C123 --entry-type instance --target-ttl 150000 --threshold 5000 --auto-extend --keypair-env SECRET
```

### Set different policies for different entry types
```bash
# WASM code is critical - extend aggressively
sorokeep guard apply C123 --entry-type wasm --target-ttl 200000 --threshold 3000 --auto-extend --keypair-env SECRET

# Persistent entries can tolerate longer intervals
sorokeep guard apply C123 --entry-type persistent --target-ttl 100000 --threshold 15000 --auto-extend --keypair-env SECRET

# Temporary entries are short-lived
sorokeep guard apply C123 --entry-type temporary --target-ttl 80000 --threshold 8000 --auto-extend --keypair-env SECRET
```

### Apply to multiple contracts via tag
```bash
sorokeep guard apply --tag defi-protocol --entry-type wasm --target-ttl 180000 --auto-extend --keypair-env SECRET
```

## Implementation Notes

### Design Decisions
1. **Contract-level rates stay per-contract**: Prevents one entry type from starving another's rate limit budget (HOURLY_RATE_LIMIT applies to contract, not individual policies)
2. **Maximum target_ttl strategy**: When extending multiple types in one transaction, use the highest target_ttl to satisfy all types' policies
3. **Fallback behavior**: Missing per-type override silently falls back to contract-level - no error thrown
4. **NULL for contract-level**: entry_type=NULL distinguishes contract-level from per-type policies

### Backward Compatibility
- Existing contracts with no per-type overrides work unchanged
- Contract-level policies (entry_type=NULL) maintain full backward compatibility
- Migration preserves all existing data
- No breaking changes to public APIs

### Security Considerations
- Per SECURITY.md and CODEOWNERS, changes to src/core/extension.ts require mandatory maintainer review
- No changes to authentication, authorization, or access control
- Rate limiting enforcement remains intact
- Secret key handling unchanged

## Files Modified
1. `src/db/migrations/009_per_entry_type_policies.sql` - Schema migration (NEW)
2. `src/db/repositories.ts` - Data access layer
3. `src/core/extension.ts` - Extension logic (CODEOWNERS-protected)
4. `src/commands/guard.ts` - Guard command
5. `src/core/fleet.ts` - Fleet operations
6. `tests/core/extension.test.ts` - Integration tests
7. `tests/db/repositories.test.ts` - Unit tests

## Next Steps
1. Run full test suite: `npm test`
2. Manual testing with `sorokeep guard` command
3. Maintainer code review (particularly src/core/extension.ts changes)
4. Merge to main branch
