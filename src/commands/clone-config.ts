import { Command } from "commander";
import { getDb } from "../db/index.js";
import { 
  getContract, 
  getExtensionPolicy, 
  getAlertConfigsForContract,
  getAlertConfigTargets,
  upsertExtensionPolicy,
  insertAlertConfig,
  addTargetToAlertConfig
} from "../db/repositories.js";

export function registerCloneConfigCommand(program: Command) {
  program
    .command("clone-config <source-contract-id> <target-contract-id>")
    .description("Clone alert configurations and extension policies from one contract to another")
    .action((sourceContractId, targetContractId) => {
      const db = getDb();
      
      const sourceContract = getContract(db, sourceContractId);
      if (!sourceContract) {
        console.error(`Source contract ${sourceContractId} not found.`);
        process.exit(1);
      }
      
      const targetContract = getContract(db, targetContractId);
      if (!targetContract) {
        console.error(`Target contract ${targetContractId} not found.`);
        process.exit(1);
      }

      // Clone Extension Policy
      const sourcePolicy = getExtensionPolicy(db, sourceContractId);
      const targetPolicy = getExtensionPolicy(db, targetContractId);
      let guardMessage = "No guard policy copied.";
      
      if (sourcePolicy) {
        upsertExtensionPolicy(db, {
          contract_id: targetContractId,
          enabled: sourcePolicy.enabled,
          target_ttl_ledgers: sourcePolicy.target_ttl_ledgers,
          extend_when_below_ledgers: sourcePolicy.extend_when_below_ledgers,
          keypair_public: sourcePolicy.keypair_public ?? undefined,
          keypair_source: sourcePolicy.keypair_source ?? undefined,
        });
        if (targetPolicy) {
          guardMessage = "Overwrote existing guard policy on target.";
        } else {
          guardMessage = "Copied guard policy to target.";
        }
      }

      // Clone Alert Configs
      const sourceAlerts = getAlertConfigsForContract(db, sourceContractId);
      let alertsCopied = 0;
      
      for (const alert of sourceAlerts) {
        const newAlertId = insertAlertConfig(db, {
          contract_id: targetContractId,
          channel_type: alert.channel_type,
          channel_target: alert.channel_target,
          threshold_ledgers: alert.threshold_ledgers,
          webhook_secret: alert.webhook_secret,
          quiet_hours_start: alert.quiet_hours_start,
          quiet_hours_end: alert.quiet_hours_end,
          quiet_hours_timezone: alert.quiet_hours_timezone,
        });
        
        const targets = getAlertConfigTargets(db, alert.id);
        for (const target of targets) {
          addTargetToAlertConfig(db, newAlertId, target.channel_type, target.channel_target);
        }
        alertsCopied++;
      }

      const alertMessage = alertsCopied > 0 ? `Appended ${alertsCopied} alert config(s) to target.` : "No alert configs copied.";
      console.log(`Successfully cloned configuration from ${sourceContractId} to ${targetContractId}`);
      console.log(`- ${guardMessage}`);
      console.log(`- ${alertMessage}`);
    });
}
