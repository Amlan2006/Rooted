import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { newSession, runAnalyst, sessionFor, sse, type AnalystDeps } from "../lib/analyst/agent";
import type { LedgerRow } from "../lib/analyst/budget";
import { BRIEF_PROMPT, SYSTEM_PROMPT } from "../lib/analyst/prompts";
import { EXECUTORS } from "../lib/analyst/tools";
import type { AnalystEvent, Executor } from "../lib/analyst/types";

const hash = "0x" + "ab".repeat(32);
type Block = Record<string, unknown>;
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 100 };
const msg = (content: Block[], stop_reason = "tool_use", extra: Block = {}) =>
  ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_details: null, usage, ...extra }) as unknown as BetaMessage;
const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const thinking = (text: string) => ({ type: "thinking", thinking: text, signature: "sig" });
const text = (t: string) => ({ type: "text", text: t });

// Fake Anthropic client: replays scripted messages, streams their thinking and text, records every request body.
// An Error with a partial message rejects after that snapshot streamed, like an abort mid-turn.
function fake(script: (BetaMessage | (Error & { partial?: BetaMessage }))[] | ((n: number) => BetaMessage)) {
  const bodies: BetaMessageStreamParams[] = [];
  const client: AnalystDeps["client"] = { beta: { messages: { stream(body) {
    bodies.push(structuredClone(body));
    const next = typeof script === "function" ? script(bodies.length) : script[bodies.length - 1];
    const listeners: Record<string, ((d: string) => void)[]> = {};
    return {
      currentMessage: next instanceof Error ? next.partial : undefined,
      on(event, listener) { (listeners[event] ??= []).push(listener); return this; },
      async finalMessage() {
        if (next instanceof Error) throw next;
        for (const b of next.content) {
          if (b.type === "thinking") listeners.thinking?.forEach(l => l(b.thinking));
          if (b.type === "text") listeners.text?.forEach(l => l(b.text));
        }
        return next;
      },
    };
  } } } };
  return { client, bodies };
}
function deps(client: AnalystDeps["client"], exec: Record<string, Executor>, spent = 0, extra: Partial<AnalystDeps> = {}) {
  const rows: LedgerRow[] = [];
  const d: AnalystDeps = { client, exec, now: () => new Date("2026-11-06T10:00:00Z"), ledger: { spent: async () => spent, add: async row => { rows.push(row); } }, ...extra };
  return { d, rows };
}
const output = (kind: "xray" | "blocks", raw: unknown) => ({ kind, label: `${kind} result`, link: `/?view=xray&block=${hash}`, raw: JSON.stringify(raw), data: raw });

test("one investigation: parallel tools, one tool_result message, cited answer, usage and ledger", async () => {
  const calls: string[] = [];
  const exec: Record<string, Executor> = {
    get_block_xray: async (input: { block_hash: string }) => { calls.push("xray " + input.block_hash); return output("xray", { data: { block: { number: 7 } } }); },
    recent_blocks: async (input: { limit: number }) => { calls.push("blocks " + input.limit); return output("blocks", { data: [] }); },
  };
  const { client, bodies } = fake([
    msg([thinking("Check the block."), use("t1", "get_block_xray", { block_hash: hash.toUpperCase().replace("0X", "0x") }), use("t2", "recent_blocks", { limit: 5 })]),
    msg([thinking("Enough."), text("Validator ceiling 20.7× [E1]; newest blocks [E2]. Unrelated [E9].")], "end_turn"),
  ]);
  const { d, rows } = deps(client, exec);
  const session = newSession(), events: AnalystEvent[] = [];
  const end = await runAnalyst("Why?", session, e => events.push(e), d);

  assert.deepEqual(calls.sort(), ["blocks 5", "xray " + hash], "inputs are validated and normalized before running");
  assert.deepEqual(events.map(e => e.type), ["thinking", "step", "step", "step_done", "step_done", "thinking", "text", "done"]);
  assert.equal(end.type, "done");
  if (end.type !== "done") return;
  assert.equal(end.answer, "Validator ceiling 20.7× [E1]; newest blocks [E2]. Unrelated [E9].");
  assert.deepEqual(end.evidence.map(e => e.id), ["E1", "E2"], "only known, cited evidence");
  assert.deepEqual(end.usage, { input: 2000, output: 400, cache_read: 10000, cache_write: 200, usd: 0.019 });
  assert.equal(rows.length, 2, "every model call is charged to the ledger");

  // History: question, full assistant turn (thinking kept), both tool_results in one user message, final answer.
  assert.equal(session.messages.length, 4);
  const results = session.messages[2].content as { type: string; tool_use_id: string; content: string; is_error?: boolean }[];
  assert.deepEqual(results.map(r => r.tool_use_id), ["t1", "t2"]);
  assert.equal(JSON.parse(results[0].content).evidence_id, "E1");
  assert.equal((session.messages[1].content as unknown as Block[])[0].type, "thinking");
  assert.equal(bodies[1].messages.length, 3, "the second call carries the whole history");

  const body = bodies[0];
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.tool_choice, { type: "auto" });
  assert.deepEqual(body.system, [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  assert.equal(body.tools?.length, 13);
  assert.ok(body.tools?.every(t => "strict" in t && t.strict === true));
});

test("invalid input and unknown tools become is_error results without running anything", async () => {
  let ran = 0;
  const exec: Record<string, Executor> = { get_block_xray: async () => { ran++; return output("xray", {}); } };
  const { client } = fake([msg([use("a", "get_block_xray", { block_hash: "0x12" }), use("b", "get_block_xray", { block_hash: hash, extra: 1 }), use("c", "nope", {})]), msg([text("Unknown.")], "end_turn")]);
  const session = newSession(), events: AnalystEvent[] = [];
  await runAnalyst("q", session, e => events.push(e), deps(client, exec).d);
  assert.equal(ran, 0);
  const results = session.messages[2].content as { is_error?: boolean; content: string }[];
  assert.ok(results.every(r => r.is_error));
  assert.match(results[0].content, /Invalid input.*32-byte/s);
  assert.match(results[1].content, /Unrecognized key/);
  assert.match(results[2].content, /Unknown tool nope/);
  assert.deepEqual(events.filter(e => e.type === "step_done").map(e => e.type === "step_done" && e.ok), [false, false, false]);
});

test("action and purchase caps hold even for parallel calls; executor errors reach the model", async () => {
  const ran: string[] = [];
  const run: Executor = async (input: { block_hash: string }) => { ran.push(input.block_hash.slice(-1)); return output("xray", {}); };
  const exec: Record<string, Executor> = { run_block_xray: run, buy_xray_report: async () => { throw new Error("refused by spend controls (exit 3)"); } };
  const h = (c: string) => "0x" + c.repeat(64);
  const { client } = fake([
    msg([use("b1", "buy_xray_report", { block_hash: h("1") }), use("b2", "buy_xray_report", { block_hash: h("2") }), use("r1", "run_block_xray", { block_hash: h("3") }), use("r2", "run_block_xray", { block_hash: h("4") }), use("r3", "run_block_xray", { block_hash: h("5") })]),
    msg([text("Done.")], "end_turn"),
  ]);
  const session = newSession();
  const events: AnalystEvent[] = [];
  await runAnalyst("q", session, e => events.push(e), deps(client, exec).d);
  assert.deepEqual(ran, ["3", "4"], "b1, r1 and r2 use the three actions; b2 is a second purchase; r3 is a fourth action");
  const results = session.messages[2].content as { tool_use_id: string; is_error?: boolean; content: string }[];
  assert.match(results[0].content, /spend controls/);
  assert.match(results[1].content, /one purchase/);
  assert.equal(results[2].is_error, undefined);
  assert.match(results[4].content, /Action limit reached \(3/);
  assert.deepEqual(events.filter(e => e.type === "step").map(e => e.type === "step" && e.action), [true, true, true, true, true]);
});

test("the step cap stops at 12 calls, nudges on the 11th and leaves a valid history", async () => {
  const { client, bodies } = fake(n => msg([use("t" + n, "xray_summary", {})]));
  const session = newSession(), events: AnalystEvent[] = [];
  const end = await runAnalyst("loop", session, e => events.push(e), deps(client, { xray_summary: async () => output("blocks", {}) }).d);
  assert.equal(bodies.length, 12);
  assert.deepEqual(end, { type: "error", code: "max_steps", message: "The investigation used all 12 steps without an answer." });
  const last = session.messages.at(-1)!;
  assert.equal(last.role, "user", "the last tool_use still gets its tool_result");
  assert.match((last.content as { content: string }[])[0].content, /Step limit reached/);
  const nudge = (session.messages.at(-3)!.content as unknown as Block[]).at(-1)!;
  assert.deepEqual(nudge.type, "text");
  assert.match(String(nudge.text), /last step/);
  assert.equal(session.evidence.length, 11);
});

test("brief mode: brief prompt, read-only tools, six steps, actions are unknown tools", async () => {
  let ran = 0;
  const { client, bodies } = fake(n => msg([use("t" + n, "run_block_xray", { block_hash: hash })]));
  const end = await runAnalyst("Block 7 triggered builder_gap.", newSession(), () => {}, deps(client, { run_block_xray: async () => { ran++; return output("xray", {}); } }, 0, { mode: "brief" }).d);
  assert.equal(bodies.length, 6);
  assert.equal(end.type === "error" && end.code, "max_steps");
  assert.equal(ran, 0);
  assert.equal((bodies[0].system as { text: string }[])[0].text, BRIEF_PROMPT);
  assert.deepEqual(bodies[0].tools?.map(t => "name" in t && t.name), ["recent_blocks", "xray_summary", "get_block_xray", "epbs_slot", "builders", "alerts", "frame_status", "frame_conformance", "frame_transactions", "node_read"]);
});

test("budget is checked before each call; refusals and API errors end with an error event", async () => {
  const over = fake([msg([text("x")], "end_turn")]);
  const end = await runAnalyst("q", newSession(), () => {}, deps(over.client, {}, 20).d);
  assert.equal(end.type === "error" && end.code, "budget");
  assert.equal(over.bodies.length, 0);

  const refused = fake([msg([text("partial")], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "Declined." } })]);
  const session = newSession();
  const r = await runAnalyst("q", session, () => {}, deps(refused.client, {}).d);
  assert.deepEqual(r, { type: "error", code: "refusal", message: "Claude declined this request (cyber). Declined." });
  assert.equal(session.messages.length, 1, "a refused partial is not echoed back");

  const failing = fake([new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad thinking" } }, "bad thinking", new Headers())]);
  const failed = deps(failing.client, {});
  const e = await runAnalyst("q", newSession(), () => {}, failed.d);
  assert.equal(e.type === "error" && e.code, "upstream");
  assert.match(e.type === "error" ? e.message : "", /bad thinking/);
  assert.equal(failed.rows.length, 0, "nothing streamed, nothing charged");

  const partial = msg([thinking("half")], "", { usage: { input_tokens: 3000, output_tokens: 1, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } });
  const aborted = fake([Object.assign(new Anthropic.APIUserAbortError(), { partial })]);
  const charged = deps(aborted.client, {});
  const a = await runAnalyst("q", newSession(), () => {}, charged.d);
  assert.equal(a.type === "error" && a.code, "upstream");
  assert.deepEqual(charged.rows, [{ at: "2026-11-06T10:00:00.000Z", mode: "investigate", input: 3000, output: 1, cache_read: 9000, cache_write: 0, usd: 0.01382 }], "an aborted turn is charged for what streamed");
});

test("after a mid-output fallback the declined model's thinking and tool calls are neither run nor echoed", async () => {
  let ran = 0;
  const { client } = fake([msg([thinking("declined"), use("x", "xray_summary", {}), text("Part "), { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } }, text("answer.")], "end_turn")]);
  const session = newSession();
  const end = await runAnalyst("q", session, () => {}, deps(client, { xray_summary: async () => { ran++; return output("blocks", {}); } }).d);
  assert.equal(ran, 0);
  assert.equal(end.type === "done" && end.answer, "Part answer.");
  assert.deepEqual((session.messages[1].content as unknown as Block[]).map(b => b.type), ["text", "fallback", "text"]);
});

test("payments are off unless ROOTED_ANALYST_PAYMENTS=true", async () => {
  delete process.env.ROOTED_ANALYST_PAYMENTS;
  await assert.rejects(EXECUTORS.buy_xray_report({ block_hash: hash } as never), /payments are off/);
  const { client } = fake([msg([use("p", "buy_xray_report", { block_hash: hash })]), msg([text("No purchase.")], "end_turn")]);
  const session = newSession();
  await runAnalyst("buy", session, () => {}, deps(client, EXECUTORS).d);
  const [result] = session.messages[2].content as { is_error?: boolean; content: string }[];
  assert.equal(result.is_error, true);
  assert.match(result.content, /payments are off/);
});

test("SSE frames and sessions", () => {
  const event: AnalystEvent = { type: "text", delta: "a\nb" };
  const frame = sse(event);
  assert.match(frame, /^data: .*\n\n$/);
  assert.equal(frame.split("\n").length, 3, "newlines inside the payload stay escaped");
  assert.deepEqual(JSON.parse(frame.slice(6)), event);

  const a = sessionFor(undefined, 0);
  assert.equal(sessionFor(a.id, 1000), a, "a follow-up keeps its session");
  assert.notEqual(sessionFor(a.id, 1000 + 3_600_001).id, a.id, "an idle session expires after an hour");
  const first = sessionFor(undefined, 5_000_000);
  for (let i = 0; i < 50; i++) sessionFor(undefined, 5_000_000);
  assert.notEqual(sessionFor(first.id, 5_000_000).id, first.id, "at most 50 sessions; the oldest goes first");
});
