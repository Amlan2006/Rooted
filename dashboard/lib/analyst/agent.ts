// The analyst loop: stream a Claude turn, run the tools it asks for (validated, capped), append everything to the
// session, repeat until it answers. Deps are injected so tests run on a fake client and fake executors.
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaMessageStreamParams, BetaToolResultBlockParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { cost, dailyLimit, type Ledger } from "./budget";
import { addEvidence, citations } from "./evidence";
import { BRIEF_PROMPT, SYSTEM_PROMPT } from "./prompts";
import { TOOLS, toolParams } from "./tools";
import { trim } from "./trim";
import type { AnalystEvent, Executor, Session, Usage } from "./types";

export const MODEL = "claude-opus-5-5";
const MODES = {
  investigate: { system: SYSTEM_PROMPT, specs: TOOLS, steps: 12, actions: 3 },
  brief: { system: BRIEF_PROMPT, specs: TOOLS.filter(t => !t.action), steps: 6, actions: 0 },
};
const PARAMS = { investigate: toolParams(MODES.investigate.specs), brief: toolParams(MODES.brief.specs) };

type Stream = {
  on(event: "thinking" | "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
  readonly currentMessage: BetaMessage | undefined;
};
export interface AnalystDeps {
  client: { beta: { messages: { stream(body: BetaMessageStreamParams, options?: { signal?: AbortSignal }): Stream } } };
  exec: Record<string, Executor>;
  now: () => Date;
  ledger: Ledger;
  mode?: "investigate" | "brief"; // brief: BRIEF_PROMPT, read-only tools, 6 steps, no actions
  signal?: AbortSignal;
}

export const sse = (event: AnalystEvent) => `data: ${JSON.stringify(event)}\n\n`;

const effort = () => {
  const value = process.env.ROOTED_ANALYST_EFFORT;
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : "medium";
};

// After a mid-output fallback the declined model's thinking and tool calls before the last fallback block must not be
// echoed (or run); text and everything after the boundary stays.
function served(content: BetaContentBlock[]) {
  const cut = content.findLastIndex(b => b.type === "fallback");
  return content.filter((b, i) => i > cut || !["thinking", "redacted_thinking", "tool_use", "server_tool_use"].includes(b.type));
}

export async function runAnalyst(question: string, session: Session, emit: (event: AnalystEvent) => void, deps: AnalystDeps): Promise<AnalystEvent> {
  const mode = deps.mode ?? "investigate", { system, specs, steps, actions } = MODES[mode];
  const usage: Usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0 };
  const finish = (event: AnalystEvent) => { emit(event); return event; };
  let actionsUsed = 0, buys = 0;
  session.messages.push({ role: "user", content: question });
  // shortcut: top-level usage only covers the attempt that answered, priced at Opus 5.5 rates; a refused attempt
  // or a fallback model's rates are not counted. Read usage.iterations if fallbacks become common.
  const charge = async (u: BetaMessage["usage"], at: Date) => {
    const spent = { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 };
    const usd = cost(spent);
    for (const k of ["input", "output", "cache_read", "cache_write"] as const) usage[k] += spent[k];
    usage.usd += usd;
    await deps.ledger.add({ at: at.toISOString(), mode, ...spent, usd });
  };

  for (let step = 1; step <= steps; step++) {
    const now = deps.now();
    if (await deps.ledger.spent(now.toISOString().slice(0, 10)) >= dailyLimit())
      return finish({ type: "error", code: "budget", message: `The analyst's daily budget of $${dailyLimit()} is spent. It resets at 00:00 UTC.` });

    let message: BetaMessage, stream: Stream | undefined;
    try {
      stream = deps.client.beta.messages.stream({
        model: MODEL, max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: effort() },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" }, // also caches the growing conversation between steps
        tools: PARAMS[mode], tool_choice: { type: "auto" },
        messages: session.messages,
      }, { signal: deps.signal });
      stream.on("thinking", text => emit({ type: "thinking", text }));
      stream.on("text", delta => emit({ type: "text", delta }));
      message = await stream.finalMessage();
    } catch (error) {
      // An aborted or broken stream is still billed: input and cache counts arrive with message_start, output with
      // the last message_delta. shortcut: output after that delta is not counted; estimate it if aborts become common.
      const partial = stream?.currentMessage?.usage;
      if (partial) await charge(partial, now);
      return finish({ type: "error", code: "upstream", message: error instanceof Anthropic.APIError ? error.message : "The Claude API call did not complete." });
    }

    await charge(message.usage, now);

    if (message.stop_reason === "refusal") {
      const d = message.stop_details;
      return finish({ type: "error", code: "refusal", message: `Claude declined this request${d?.category ? ` (${d.category})` : ""}. ${d?.explanation ?? ""}`.trim() });
    }
    const content = served(message.content);
    const uses = content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    // Not appended: a tool_use without its tool_result would break every follow-up turn.
    if (message.stop_reason === "max_tokens" && uses.length)
      return finish({ type: "error", code: "upstream", message: "Claude ran out of output tokens in the middle of a tool call." });
    session.messages.push({ role: "assistant", content });
    if (message.stop_reason !== "tool_use" || !uses.length) {
      const answer = content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
      const cited = new Set(citations(answer));
      usage.usd = Math.round(usage.usd * 1e6) / 1e6;
      return finish({ type: "done", answer, evidence: session.evidence.filter(e => cited.has(e.id)), usage });
    }

    // Caps are decided in call order before anything runs, so parallel calls cannot overshoot them.
    const plans = uses.map(use => {
      const spec = specs.find(s => s.name === use.name), parsed = spec?.input.safeParse(use.input);
      let refusal = "";
      if (step === steps) refusal = "Step limit reached; this tool did not run.";
      else if (!spec || !deps.exec[use.name]) refusal = `Unknown tool ${use.name}.`;
      else if (!parsed?.success) refusal = `Invalid input: ${z.prettifyError(parsed!.error!)}`;
      else if (spec.action && actionsUsed >= actions) refusal = `Action limit reached (${actions} per question). Answer from the evidence you have.`;
      else if (spec.payment && buys >= 1) refusal = "Only one purchase is allowed per question.";
      if (!refusal && spec?.action) actionsUsed++;
      if (!refusal && spec?.payment) buys++;
      emit({ type: "step", id: use.id, tool: use.name, input: use.input, action: !!spec?.action });
      return { use, refusal, input: parsed?.data };
    });
    const results = await Promise.all(plans.map(async ({ use, refusal, input }): Promise<BetaToolResultBlockParam> => {
      const started = performance.now(), ms = () => Math.round(performance.now() - started);
      const fail = (note: string): BetaToolResultBlockParam => {
        emit({ type: "step_done", id: use.id, ok: false, ms: ms(), note });
        return { type: "tool_result", tool_use_id: use.id, is_error: true, content: note };
      };
      if (refusal) return fail(refusal);
      try {
        const out = await deps.exec[use.name](input as never, deps.signal);
        const evidence = addEvidence(session.evidence, out, deps.now());
        emit({ type: "step_done", id: use.id, ok: true, ms: ms(), evidence, note: out.label });
        return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ evidence_id: evidence.id, data: trim(use.name, out.data) }) };
      } catch (error) {
        return fail(error instanceof Error ? error.message : "The tool failed.");
      }
    }));
    // All results of one turn go back in one user message; the last allowed step also gets a nudge to answer.
    session.messages.push({ role: "user", content: step === steps - 1 ? [...results, { type: "text", text: "This is the last step: answer now from the evidence you have. Tools will not run again." }] : results });
    if (step === steps) break;
  }
  return finish({ type: "error", code: "max_steps", message: `The investigation used all ${steps} steps without an answer.` });
}

// In-memory sessions, 1 h idle TTL, at most 50; the least recently used goes first.
const sessions = new Map<string, Session>();
export function sessionFor(id: string | undefined, now = Date.now()): Session {
  for (const [key, s] of sessions) if (now - s.at > 3_600_000) sessions.delete(key);
  const found = id ? sessions.get(id) : undefined;
  const session = found ?? { id: randomUUID(), messages: [], evidence: [], at: now };
  sessions.delete(session.id);
  while (sessions.size >= 50) sessions.delete(sessions.keys().next().value!);
  session.at = now;
  sessions.set(session.id, session);
  return session;
}
export const newSession = (): Session => ({ id: randomUUID(), messages: [], evidence: [], at: Date.now() });
