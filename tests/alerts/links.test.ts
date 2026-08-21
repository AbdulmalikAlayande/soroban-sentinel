import { describe, it, expect } from "vitest";
import { buildStellarExpertUrl, getStellarExpertContractUrl } from "../../src/alerts/links";
import type { AlertEvent } from "../../src/alerts/types";

describe("buildStellarExpertUrl", () => {
    it("builds a mainnet contract URL", () => {
        expect(buildStellarExpertUrl("mainnet", "contract", "CABC123")).toBe(
            "https://stellar.expert/explorer/public/contract/CABC123",
        );
    });

    it("builds a testnet contract URL using the testnet host and path", () => {
        expect(buildStellarExpertUrl("testnet", "contract", "CABC123")).toBe(
            "https://testnet.stellar.expert/explorer/testnet/contract/CABC123",
        );
    });

    it("builds a transaction URL", () => {
        expect(buildStellarExpertUrl("mainnet", "transaction", "abc123hash")).toBe(
            "https://stellar.expert/explorer/public/transaction/abc123hash",
        );
    });

    it("treats an unrecognized network as mainnet (defaults to public host)", () => {
        expect(buildStellarExpertUrl("futurenet", "contract", "CABC123")).toBe(
            "https://stellar.expert/explorer/public/contract/CABC123",
        );
    });

    it("is case-insensitive for the network name", () => {
        expect(buildStellarExpertUrl("TESTNET", "contract", "CABC123")).toBe(
            "https://testnet.stellar.expert/explorer/testnet/contract/CABC123",
        );
    });

    it("URL-encodes the value", () => {
        expect(buildStellarExpertUrl("mainnet", "contract", "abc/def")).toBe(
            "https://stellar.expert/explorer/public/contract/abc%2Fdef",
        );
    });

    it("returns undefined for an empty value", () => {
        expect(buildStellarExpertUrl("mainnet", "contract", "")).toBeUndefined();
    });

    it("defaults to mainnet when network is empty", () => {
        expect(buildStellarExpertUrl("", "contract", "CABC123")).toBe(
            "https://stellar.expert/explorer/public/contract/CABC123",
        );
    });
});

describe("getStellarExpertContractUrl", () => {
    function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
        return {
            type: "threshold_crossed",
            severity: "warning",
            contractId: "CDEF1234ABCD5678",
            contractName: "my-contract",
            network: "testnet",
            entry: { keyXdr: "AAAA", type: "instance", label: "Instance" },
            threshold: {
                configuredLedgers: 20_000,
                currentRemainingLedgers: 8_500,
                approximateTimeRemaining: "~13h 0m",
            },
            firedAtLedger: 2_500_000,
            timestamp: "2026-05-21T20:37:08.000Z",
            ...overrides,
        } as AlertEvent;
    }

    it("builds the contract URL from the event's network and contractId", () => {
        const event = makeEvent({ contractId: "CXYZ999", network: "mainnet" });
        expect(getStellarExpertContractUrl(event)).toBe(
            "https://stellar.expert/explorer/public/contract/CXYZ999",
        );
    });

    it("uses the testnet host for testnet events", () => {
        const event = makeEvent({ network: "testnet" });
        expect(getStellarExpertContractUrl(event)).toBe(
            "https://testnet.stellar.expert/explorer/testnet/contract/CDEF1234ABCD5678",
        );
    });
});
