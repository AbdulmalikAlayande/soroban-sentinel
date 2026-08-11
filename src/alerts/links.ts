import type { AlertEvent } from "./types.js";

export function buildStellarExpertUrl(
  network: string,
  kind: "contract" | "transaction",
  value: string,
): string | undefined {
  if (!value) return undefined;

  const normalizedNetwork = (network || "mainnet").toLowerCase();
  const host =
    normalizedNetwork === "testnet"
      ? "testnet.stellar.expert"
      : "stellar.expert";
  const networkPath = normalizedNetwork === "testnet" ? "testnet" : "public";

  return `https://${host}/explorer/${networkPath}/${kind}/${encodeURIComponent(value)}`;
}

export function getStellarExpertContractUrl(
  event: AlertEvent,
): string | undefined {
  return buildStellarExpertUrl(event.network, "contract", event.contractId);
}
