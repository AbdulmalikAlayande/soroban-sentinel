import { describe, it, expect } from "vitest";
import { getTemplateContext } from "../../src/alerts/templates";
import type { AlertEvent } from "../../src/alerts/types";

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: "threshold_crossed",
    severity: "warning",
    contractId: "CABC1234",
    contractName: "my-contract",
    network: "mainnet",
    entry: {
      keyXdr: "AAAA1",
      type: "instance",
      label: "primary-entry",
    },
    threshold: {
      configuredLedgers: 1000,
      currentRemainingLedgers: 120,
      approximateTimeRemaining: "~2h",
    },
    firedAtLedger: 3_000_000,
    timestamp: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("getTemplateContext", () => {
  it("exposes a Stellar.expert contract link for mainnet alerts", () => {
    const context = getTemplateContext(makeAlertEvent({ network: "mainnet" }));
    expect(context.stellarExpertContractUrl).toBe(
      "https://stellar.expert/explorer/public/contract/CABC1234",
    );
  });

  it("exposes a Stellar.expert contract link for testnet alerts", () => {
    const context = getTemplateContext(makeAlertEvent({ network: "testnet" }));
    expect(context.stellarExpertContractUrl).toBe(
      "https://testnet.stellar.expert/explorer/testnet/contract/CABC1234",
    );
  });

  it("returns undefined for alerts without a contract ID", () => {
    const context = getTemplateContext(makeAlertEvent({ contractId: "" }));
    expect(context.stellarExpertContractUrl).toBeUndefined();
  });
});
