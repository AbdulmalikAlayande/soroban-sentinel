import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const watchManifestEntrySchema = z
  .object({
    id: z.string().min(1).optional(),
    contractId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    network: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    storageKeys: z.array(z.string().min(1)).optional(),
    pollIntervalSeconds: z.number().int().positive().optional(),
    rpcUrl: z.string().min(1).optional(),
    noIntrospection: z.boolean().optional(),
  })
  .refine((entry) => entry.id || entry.contractId, {
    message: "Each manifest entry must define an id or contractId",
  });

const watchManifestSchema = z.union([
  z.array(watchManifestEntrySchema),
  z.object({
    contracts: z.array(watchManifestEntrySchema),
  }),
]);

export type WatchManifestEntry = z.infer<typeof watchManifestEntrySchema>;

export function parseWatchManifest(raw: string): WatchManifestEntry[] {
  const parsed = YAML.parse(raw);
  const validated = watchManifestSchema.parse(parsed);
  return Array.isArray(validated) ? validated : validated.contracts;
}

export function loadWatchManifest(filePath: string): WatchManifestEntry[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  let parsed: unknown;
  if (ext === ".json") {
    parsed = JSON.parse(raw);
  } else {
    parsed = YAML.parse(raw);
  }

  const validated = watchManifestSchema.parse(parsed);
  return Array.isArray(validated) ? validated : validated.contracts;
}
