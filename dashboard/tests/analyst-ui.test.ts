import { test } from "node:test";
import assert from "node:assert/strict";
import { citations, evidenceList, firstLines, httpFailure, idle, parseSSE, reduce, safeLink, type UIEvent } from "../lib/analyst/ui-state";
import type { Evidence } from "../lib/analyst/types";

const ev = (id: string): Evidence => ({ id, kind: "xray", label: `X-ray ${id}`, link: "/?view=xray&block=0x" + "a".repeat(64), sha256: "b".repeat(64), at: "2026-11-06T10:00:00Z" });
const usage = { input: 1200, output: 300, cache_read: 9000, cache_write: 0, usd: 0.0126 };
const run = (events: UIEvent[], from = idle) => events.reduce(reduce, from);

test("a full investigation reduces to steps, evidence, answer and usage", () => {
  const s = run([
    { type: "ask", question: "Why?" },
    { type: "session", session_id: "s1" },
    { type: "thinking", text: "Look up " },
    { type: "thinking", text: "the block." },
    { type: "step", id: "t1", tool: "get_block_xray", input: { block_hash: "0x1" }, action: false },
    { type: "step", id: "t2", tool: "buy_xray_report", input: { block_hash: "0x1" }, action: true },
    { type: "step_done", id: "t2", ok: false, ms: 12, note: "payments are off" },
    { type: "step_done", id: "t1", ok: true, ms: 340, evidence: ev("E1"), note: "stored" },
    { type: "thinking", text: "Builder gap found." },
    { type: "text", delta: "Ceiling 2.1× " },
    { type: "text", delta: "[E1]." },
    { type: "done", answer: "Ceiling 2.1× [E1].", evidence: [ev("E1"), ev("E2")], usage },
    { type: "closed" },
  ]);
  assert.equal(s.status, "done");
  assert.equal(s.session_id, "s1");
  assert.equal(s.thinking, "Builder gap found.", "thinking after a step starts a new run");
  assert.deepEqual(s.steps.map(x => [x.id, x.result?.ok, x.result?.ms]), [["t1", true, 340], ["t2", false, 12]]);
  assert.deepEqual(Object.keys(s.evidence), ["E1", "E2"]);
  assert.equal(s.answer, "Ceiling 2.1× [E1].");
  assert.deepEqual(s.usage, usage);
});

test("consecutive thinking events form one run", () => {
  const s = run([{ type: "ask", question: "q" }, { type: "thinking", text: "a" }, { type: "thinking", text: "b" }]);
  assert.equal(s.thinking, "ab");
});

test("errors keep partial work and freeze the view", () => {
  const s = run([
    { type: "ask", question: "q" },
    { type: "step", id: "t1", tool: "recent_blocks", input: { limit: 5 }, action: false },
    { type: "text", delta: "Partial" },
    { type: "error", code: "max_steps", message: "12 steps used" },
    { type: "text", delta: " late" },
    { type: "closed" },
  ]);
  assert.equal(s.status, "error");
  assert.equal(s.error?.code, "max_steps");
  assert.equal(s.answer, "Partial");
  assert.equal(s.steps.length, 1);
});

test("a stream that closes mid-run is an upstream error", () => {
  const s = run([{ type: "ask", question: "q" }, { type: "closed" }]);
  assert.equal(s.error?.code, "upstream");
});

test("a new question keeps the session; reset drops it", () => {
  const first = run([{ type: "ask", question: "one" }, { type: "session", session_id: "s1" }, { type: "text", delta: "x" }, { type: "done", answer: "x", evidence: [], usage }]);
  const next = reduce(first, { type: "ask", question: "two" });
  assert.deepEqual([next.status, next.question, next.session_id, next.answer, next.steps.length], ["running", "two", "s1", "", 0]);
  assert.equal(reduce(next, { type: "reset" }).session_id, undefined);
});

test("parseSSE splits complete frames and keeps the tail", () => {
  const a = parseSSE('data: {"type":"session","session_id":"s1"}\n\n: ping\n\ndata: {"type":"text","de');
  assert.deepEqual(a.events, [{ type: "session", session_id: "s1" }]);
  const b = parseSSE(a.rest + 'lta":"hi"}\n\n');
  assert.deepEqual(b.events, [{ type: "text", delta: "hi" }]);
  assert.equal(b.rest, "");
});

test("httpFailure maps non-SSE responses to error events", () => {
  assert.deepEqual(httpFailure(503, { type: "error", code: "disabled", message: "off" }), { type: "error", code: "disabled", message: "off" });
  assert.deepEqual(httpFailure(400, { error: { message: "too long" } }), { type: "error", code: "bad_request", message: "too long" });
  assert.equal(httpFailure(429, null).code, "upstream");
  assert.match(httpFailure(429, null).message, /Another investigation/);
  assert.equal(httpFailure(502, { error: { code: "weird" } }).message, "Analyst HTTP 502");
});

test("citations split single and grouped evidence ids", () => {
  assert.deepEqual(citations("A [E1] and B [E2, E10]."), ["A ", { cite: "E1" }, " and B ", { cite: "E2" }, { cite: "E10" }, "."]);
  assert.deepEqual(citations("[E3]"), [{ cite: "E3" }]);
  assert.deepEqual(citations("no [cite] here [e1]"), ["no [cite] here [e1]"]);
});

test("safeLink allows https and same-origin paths only", () => {
  assert.equal(safeLink("/?view=xray&block=0x1"), "/?view=xray&block=0x1");
  assert.equal(safeLink("https://hashscan.io/testnet/transaction/1"), "https://hashscan.io/testnet/transaction/1");
  assert.equal(safeLink("javascript:alert(1)"), undefined);
  assert.equal(safeLink("//evil.example"), undefined);
  assert.equal(safeLink("http://insecure.example"), undefined);
  assert.equal(safeLink(undefined), undefined);
});

test("firstLines skips blank lines", () => {
  assert.deepEqual(firstLines("\nOne.\n\n  Two.\nThree."), ["One.", "Two."]);
});

test("evidenceList drops malformed stored evidence", () => {
  assert.deepEqual(evidenceList([ev("E1"), { id: "E2" }, null, "E3", { ...ev("E4"), kind: 4 }]), [ev("E1")]);
  assert.deepEqual(evidenceList({ id: "E1" }), []);
});
