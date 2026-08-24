import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { xdr } from "@stellar/stellar-sdk";
import { scvalToJSON } from "../../src/core/scvalTranslator";

describe("scvalTranslator fuzz tests", () => {
    it("should never throw an uncaught exception for random XDR bytes", () => {
        fc.assert(
            fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
                let val: xdr.ScVal;
                try {
                    val = xdr.ScVal.fromXDR(Buffer.from(bytes));
                } catch (e) {
                    // Not valid XDR at all — nothing for scvalToJSON to do here,
                    // this test targets scvalToJSON's own robustness, not the SDK's.
                    return true;
                }

                try {
                    scvalToJSON(val);
                } catch (e) {
                    // It's allowed to throw, but it must be a standard, catchable Error.
                    expect(e).toBeInstanceOf(Error);
                }
                return true;
            }),
            { numRuns: 1000 },
        );
    });

    it("should never throw an uncaught exception for oversized byte sequences", () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 1024, maxLength: 8192 }), (bytes) => {
                let val: xdr.ScVal;
                try {
                    val = xdr.ScVal.fromXDR(Buffer.from(bytes));
                } catch (e) {
                    return true;
                }
                try {
                    scvalToJSON(val);
                } catch (e) {
                    expect(e).toBeInstanceOf(Error);
                }
                return true;
            }),
            { numRuns: 200 },
        );
    });
});
