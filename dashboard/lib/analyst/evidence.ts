import { createHash } from "node:crypto";
import type { Evidence, ToolOutput } from "./types";

export const xrayLink = (hash: string) => `/?view=xray&block=${hash}`;
export const txLink = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

// Ids run E1..En across a whole session, so a follow-up answer can still cite earlier evidence.
export function addEvidence(list: Evidence[], out: Pick<ToolOutput, "kind" | "label" | "link" | "raw">, at: Date): Evidence {
  const evidence: Evidence = { id: `E${list.length + 1}`, kind: out.kind, label: out.label, sha256: createHash("sha256").update(out.raw).digest("hex"), at: at.toISOString() };
  if (out.link) evidence.link = out.link;
  list.push(evidence);
  return evidence;
}

// Ids cited as [E3] or [E3, E5], first appearance order, no repeats.
export function citations(text: string): string[] {
  const ids = [...text.matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)].flatMap(m => m[1].split(/\s*,\s*/));
  return [...new Set(ids)];
}
