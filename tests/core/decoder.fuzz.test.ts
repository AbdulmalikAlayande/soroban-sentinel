import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decodeLedgerKey } from "../../src/core/decoder";

describe("decoder fuzz tests", () => {
    it("should never throw an uncaught exception for random base64 strings", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 1000 }), (str) => {
                try {
                    const base64Str = Buffer.from(str).toString("base64");
                    decodeLedgerKey(base64Str);
                } catch (e) {
                    // If it throws, it should be a standard Error, never something
                    // uncatchable (a raw string throw, undefined, etc.)
                    expect(e).toBeInstanceOf(Error);
                }
                return true;
            }),
            { numRuns: 1000 },
        );
    });

    it("should never throw an uncaught exception for arbitrary byte sequences encoded as base64", () => {
        fc.assert(
            fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
                try {
                    decodeLedgerKey(Buffer.from(bytes).toString("base64"));
                } catch (e) {
                    expect(e).toBeInstanceOf(Error);
                }
                return true;
            }),
            { numRuns: 1000 },
        );
    });

    it("should never throw an uncaught exception for truncated/malformed base64", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 200 }).filter((s) => s.length > 0), (str) => {
                try {
                    decodeLedgerKey(str);
                } catch (e) {
                    expect(e).toBeInstanceOf(Error);
                }
                return true;
            }),
            { numRuns: 500 },
        );
    });
});
