import { registerBuiltinChannels } from "../alerts/builtins.js";
import { getAlertChannel } from "../alerts/registry.js";
import { getDatabase } from "../db/database.js";
import { insertAlertConfig, upsertExtensionPolicy } from "../db/repositories.js";
import { watchContract } from "./watch.js";

export interface InitAnswers {
  contractId: string;
  network?: string;
  rpcUrl?: string;
  name?: string;
  channelType: string;
  channelTarget: string;
  guardEnabled?: boolean;
  guardTargetTtlLedgers?: number;
  guardThresholdLedgers?: number;
  alertThresholdLedgers?: number;
}

export interface InitResult {
  success: boolean;
  contractId: string;
  error?: string;
}

export async function runInitWizard(answers: InitAnswers): Promise<InitResult> {
  registerBuiltinChannels();

  const contractId = answers.contractId?.trim();
  if (!contractId || !contractId.startsWith("C") || contractId.length !== 56) {
    return {
      success: false,
      contractId: contractId ?? "",
      error: "Invalid Contract ID format. Must be a 56-character string starting with 'C'.",
    };
  }

  const channelType = answers.channelType?.trim();
  if (!channelType) {
    return {
      success: false,
      contractId,
      error: "An alert channel type is required.",
    };
  }

  const channelDef = getAlertChannel(channelType);
  if (!channelDef) {
    return {
      success: false,
      contractId,
      error: `Unsupported alert channel type "${channelType}".`,
    };
  }

  const target = answers.channelTarget?.trim();
  if (!target) {
    return {
      success: false,
      contractId,
      error: "An alert channel target is required.",
    };
  }

  const targetTtlLedgers = answers.guardTargetTtlLedgers ?? 100_000;
  const thresholdLedgers = answers.guardThresholdLedgers ?? 20_000;
  const alertThresholdLedgers = answers.alertThresholdLedgers ?? 20_000;
  const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
  if (
    !isPositiveInteger(targetTtlLedgers) ||
    !isPositiveInteger(thresholdLedgers) ||
    !isPositiveInteger(alertThresholdLedgers)
  ) {
    return {
      success: false,
      contractId,
      error: "Guard target, guard threshold, and alert threshold values must be positive integers.",
    };
  }
  if (thresholdLedgers >= targetTtlLedgers) {
    return {
      success: false,
      contractId,
      error: "Guard threshold must be less than the target TTL.",
    };
  }

  const db = getDatabase();
  const watchResult = await watchContract(db, {
    contractId,
    network: answers.network ?? "testnet",
    name: answers.name,
    rpcUrl: answers.rpcUrl,
  });

  if (!watchResult.success) {
    return {
      success: false,
      contractId,
      error: watchResult.error,
    };
  }

  const persist = db.transaction(() => {
    db.prepare("DELETE FROM alert_configs WHERE contract_id = ?").run(contractId);
    insertAlertConfig(db, {
      contract_id: contractId,
      channel_type: channelType,
      channel_target: target,
      threshold_ledgers: alertThresholdLedgers,
    });
    upsertExtensionPolicy(db, {
      contract_id: contractId,
      enabled: answers.guardEnabled !== false,
      target_ttl_ledgers: targetTtlLedgers,
      extend_when_below_ledgers: thresholdLedgers,
    });
  });
  persist();

  return {
    success: true,
    contractId,
  };
}
