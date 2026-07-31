import fs from "node:fs";

/**
 * Parses Soroban / Stellar CLI deployment records to extract valid contract IDs.
 * Matches:
 * - Raw console logs (any occurrences of a valid contract ID: 56 characters starting with 'C')
 * - JSON structures containing keys like "contract_id", "contractId", "id", or just strings.
 *
 * Duplicates are automatically removed, and registration order is preserved.
 *
 * @param filePath The path to the deployment log file
 * @returns Array of unique, valid Contract IDs (56-character string starting with 'C')
 */
export function parseDeploymentLog(filePath: string): string[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    throw new Error(err.message || `Failed to read file at ${filePath}`);
  }

  const trimmed = content.trim();
  if (trimmed === "") {
    throw new Error("Deployment log is empty");
  }

  const contractIds = new Set<string>();
  const orderedIds: string[] = [];

  function addIfValid(id: string) {
    if (id.startsWith("C") && id.length === 56 && /^[A-Z0-9]+$/.test(id)) {
      if (!contractIds.has(id)) {
        contractIds.add(id);
        orderedIds.push(id);
      }
    }
  }

  // Check if JSON format
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);

      // Recursive helper to traverse JSON finding anything that resembles a contract ID or specific keys
      function traverse(obj: any) {
        if (!obj || typeof obj !== "object") {
          if (typeof obj === "string") {
            addIfValid(obj);
          }
          return;
        }

        if (Array.isArray(obj)) {
          for (const item of obj) {
            traverse(item);
          }
        } else {
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === "string") {
              // Priority fields: id, contract_id, contractId
              if (["id", "contract_id", "contractId"].includes(key.toLowerCase()) || (key.toLowerCase().includes("contract") && key.toLowerCase().includes("id"))) {
                addIfValid(val);
              } else {
                addIfValid(val);
              }
            } else {
              traverse(val);
            }
          }
        }
      }

      traverse(parsed);

    } catch (err) {
      // If JSON parsing failed, fallback to plain-text regex matching
    }
  }

  // If JSON didn't find any or we bypassed JSON parsing, do a generic plain-text search.
  // We scan using RegExp for any 56-character base32 strings starting with C
  const contractIdRegex = /\bC[A-Z0-9]{55}\b/g;
  const matches = content.match(contractIdRegex);
  if (matches) {
    for (const match of matches) {
      addIfValid(match);
    }
  }

  if (orderedIds.length === 0) {
    throw new Error("No valid contract IDs found in the deployment log");
  }

  return orderedIds;
}
