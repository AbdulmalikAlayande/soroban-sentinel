/**
 * inspect.catch.test.ts
 *
 * Covers the three try/catch fallback branches inside decodeScValRecursive
 * that require scValToNative to throw:
 *
 *   1. bigint types (scvU64/scvI64/scvU128/scvI128/scvU256/scvI256)
 *      → value = "<unsupported bigint>"
 *
 *   2. scvAddress
 *      → value = "<address>"
 *
 *   3. default branch
 *      → value = `<native conversion failed for ${type}>`
 *
 * These branches are impossible to reach with the real SDK for well-formed
 * XDR, so this file uses vi.mock (hoisted by Vitest) to replace scValToNative
 * with a version that throws on demand.
 */

import { describe, it, expect, vi } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

// vi.mock is hoisted before all imports, so it intercepts the scValToNative
// binding that inspect.ts received at module load time — this is the key
// mechanism that makes the catch branches reachable.
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
    return {
        ...actual,
        // Replace scValToNative with a version that can be overridden per-test
        scValToNative: vi.fn(actual.scValToNative),
    };
});

// Import decodeScVal AFTER vi.mock so it picks up the mocked scValToNative
import { decodeScVal } from "../../src/core/inspect";
import { scValToNative } from "@stellar/stellar-sdk";

const mockedScValToNative = vi.mocked(scValToNative);

describe("decodeScVal — try/catch fallback paths (forced via vi.mock)", () => {
    it("returns '<unsupported bigint>' when scValToNative throws on a bigint ScVal type", () => {
        mockedScValToNative.mockImplementationOnce(() => {
            throw new Error("bigint conversion not supported");
        });

        const scVal = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 99n }));
        const result = decodeScVal(scVal.toXDR("base64"));

        expect(result.type).toBe("scvI128");
        expect(result.value).toBe("<unsupported bigint>");
    });

    it("returns '<address>' when scValToNative throws on scvAddress", () => {
        mockedScValToNative.mockImplementationOnce(() => {
            throw new Error("address conversion failure");
        });

        // Build a valid scvAddress ScVal
        const scVal = xdr.ScVal.scvAddress(
            xdr.ScAddress.scAddressTypeAccount(
                xdr.PublicKey.publicKeyTypeEd25519(
                    Buffer.alloc(32, 0x01),
                ),
            ),
        );
        const result = decodeScVal(scVal.toXDR("base64"));

        expect(result.type).toBe("scvAddress");
        expect(result.value).toBe("<address>");
    });

    it("returns '<native conversion failed for …>' when scValToNative throws on the default branch", () => {
        mockedScValToNative.mockImplementationOnce(() => {
            throw new Error("unknown type conversion failure");
        });

        // scvLedgerKeyContractInstance falls through to the default case
        const scVal = xdr.ScVal.scvLedgerKeyContractInstance();
        const result = decodeScVal(scVal.toXDR("base64"));

        expect(result.type).toBe("scvLedgerKeyContractInstance");
        expect(result.value).toBe("<native conversion failed for scvLedgerKeyContractInstance>");
    });
});
