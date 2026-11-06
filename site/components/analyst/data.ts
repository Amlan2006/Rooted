// Typed view of data/analyst.json (`npm run snapshot:analyst`): one stored brief and its Hedera trail.
import json from "@/data/analyst.json";

export type Evidence = { id: string; kind: string; label: string; link: string; sha256: string; at: string };
export type AnalystRun = {
  source: string;
  captured_at: string;
  network: string;
  block_number: number;
  block_hash: string;
  triggers: string[];
  created_at: string;
  model: string;
  usd: number;
  question: string;
  question_source: string;
  brief: string;
  brief_sha256: string;
  steps: { tool: string; input: { block_hash?: string }; evidence: string; at: string }[];
  evidence: Evidence[];
  tools: string[];
  hcs: { topic: string; sequence: number; consensus_at: string; brief_sha256: string };
  payment: {
    tx_id: string;
    result: string;
    network: string;
    amount_tinybars: number;
    payer: string;
    pay_to: string;
    fee_payer: string;
    report_sha256: string;
    consensus_at: string;
    hcs_topic: string;
    hcs_sequence: number;
  };
};

export const analyst: AnalystRun = json;

/** "2026-11-06T14:40:59.779Z" → "14:40:59" (UTC). */
export const hms = (iso: string) => iso.slice(11, 19);
/** 1 HBAR = 10^8 tinybars. */
export const hbar = (tinybars: number) => `${tinybars / 1e8} HBAR`;
export const hashscanTx = (id: string) => `https://hashscan.io/testnet/transaction/${id}`;
export const hashscanTopic = (topic: string) => `https://hashscan.io/testnet/topic/${topic}`;

export type Token = { text: string } | { cite: string };
/**
 * The brief as lines (first is the headline, "- " lines are bullets), split into words and [E#] citations. Words are
 * grouped so a chip never wraps away from the word before it or the punctuation after it.
 */
export const paragraphs = analyst.brief
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => {
    const bullet = line.startsWith("- ");
    const tokens: Token[] = (bullet ? line.slice(2) : line).split(/(\[E\d+\])/).flatMap((part): Token[] => {
      const cite = /^\[(E\d+)\]$/.exec(part)?.[1];
      return cite ? [{ cite }] : (part.match(/\S+\s*|\s+/g) ?? []).map((text) => ({ text }));
    });
    const groups: Token[][] = [];
    tokens.forEach((t, i) => {
      const prev = tokens[i - 1];
      const glue = "cite" in t || (prev && "cite" in prev && "text" in t && /^[^\s\w]/.test(t.text));
      if (glue && groups.length) groups[groups.length - 1].push(t);
      else groups.push([t]);
    });
    return { bullet, groups };
  });
