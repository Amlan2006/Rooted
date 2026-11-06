// The analyst contract (docs/superpowers/specs/2026-11-06-rooted-analyst-design.md): the SSE events, evidence and
// stored briefs shared by the agent, the route, the Analyst view and the auto-brief generator.
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";

export type EvidenceKind = "xray" | "xray_run" | "summary" | "blocks" | "epbs_slot" | "builders" | "alerts"
  | "frame_node" | "frame_conformance" | "frame_txs" | "provider_compare" | "rpc" | "payment" | "brief";
export interface Evidence { id: string; kind: EvidenceKind; label: string; link?: string; sha256: string; at: string }
export type Usage = { input: number; output: number; cache_read: number; cache_write: number; usd: number };
export type AnalystEvent =
  | { type: "session"; session_id: string }
  | { type: "thinking"; text: string } // summarized thinking, streamed as deltas
  | { type: "step"; id: string; tool: string; input: unknown; action: boolean }
  | { type: "step_done"; id: string; ok: boolean; ms: number; evidence?: Evidence; note: string }
  | { type: "text"; delta: string }
  | { type: "done"; answer: string; evidence: Evidence[]; usage: Usage }
  | { type: "error"; code: "disabled" | "budget" | "refusal" | "max_steps" | "upstream" | "bad_request"; message: string };

// What an executor hands back: the exact bytes it received (hashed into the evidence), the parsed value (trimmed
// for the model) and how to label and link the evidence. Executors throw an Error whose message the model sees.
export type ToolOutput = { kind: EvidenceKind; label: string; link?: string; raw: string; data: unknown };
export type Executor = (input: never, signal?: AbortSignal) => Promise<ToolOutput>;
export interface ToolSpec {
  name: string;
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  action: boolean; // costs time, node capacity or money; capped per question and never offered in brief mode
  payment?: boolean;
}

// Server-side conversation state. The browser only ever holds the id.
export interface Session { id: string; messages: BetaMessageParam[]; evidence: Evidence[]; at: number }

// One stored auto-brief (GET /api/v1/analyst/briefs rows); the generator POSTs it without network and created_at.
export interface Brief {
  network: string; block_hash: string; block_number: number; created_at: string;
  triggers: string[]; brief: string; evidence: Evidence[]; model: string; usd: number;
}
