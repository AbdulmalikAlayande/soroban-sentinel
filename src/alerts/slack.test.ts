import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackChannel } from "../../src/alerts/slack";
import type { AlertEvent } from "../../src/alerts/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

function makeOkResponse(): Response {
  return new Response(null, { status: 200 });
}

describe("SlackChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("includes a Stellar.expert contract link in default payloads for mainnet alerts", async () => {
    mockFetch.mockResolvedValue(makeOkResponse());
    const channel = new SlackChannel("https://hooks.slack.com/services/test");

    await channel.send(makeAlertEvent({ network: "mainnet" }));

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body as string);
    expect(body.text).toContain(
      "https://stellar.expert/explorer/public/contract/CABC1234",
    );
  });

  it("uses the testnet Stellar.expert host for testnet alerts", async () => {
    mockFetch.mockResolvedValue(makeOkResponse());
    const channel = new SlackChannel("https://hooks.slack.com/services/test");

    await channel.send(makeAlertEvent({ network: "testnet" }));

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body as string);
    expect(body.text).toContain(
      "https://testnet.stellar.expert/explorer/testnet/contract/CABC1234",
    );
  });
});
