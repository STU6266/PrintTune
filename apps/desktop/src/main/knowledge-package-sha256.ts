import { createHash } from "node:crypto";

export function computeKnowledgePackageSha256(rawText: string): string {
  return createHash("sha256").update(rawText, "utf8").digest("hex");
}
