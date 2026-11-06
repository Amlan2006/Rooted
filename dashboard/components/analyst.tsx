"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import { Brain, ExternalLink, LoaderCircle, Send, X } from "lucide-react";
import { age, ms } from "@/lib/data";
import type { AnalystEvent, Brief, Evidence } from "@/lib/analyst/types";
import { citations, evidenceList, firstLines, httpFailure, idle, parseSSE, reduce, safeLink, type Step } from "@/lib/analyst/ui-state";
import { Badge, Panel } from "./ui";

const suggestions = [
  "Why does the builder lose parallelism in block 12,076,467?",
  "Is ePBS delivering payloads on time over the last 20 slots?",
  "Find Uniswap contention in recent blocks and explain it.",
  "Which Uniswap pools caused contention?",
  "Which recent block shows the biggest gap between gas and measured time?",
];
const failures: Record<Extract<AnalystEvent, { type: "error" }>["code"], [string, string]> = {
  disabled: ["neutral", "The analyst is off on this deployment. It needs ANTHROPIC_API_KEY on the server, and ROOTED_ANALYST_PUBLIC=true when hosted."],
  budget: ["amber", "Today's analyst budget is spent. The daily cap is ROOTED_ANALYST_DAILY_USD; it resets with the next day's ledger."],
  refusal: ["red", "Claude declined to answer this question."],
  max_steps: ["amber", "Stopped at the step cap (12 model steps, 3 actions). The evidence so far is above; ask a narrower follow-up."],
  upstream: ["red", "The investigation failed upstream."],
  bad_request: ["red", "The question was rejected."],
};
const triggerTone: Record<string, string> = { builder_gap: "amber", gas_misleads: "blue", big_block: "neutral", commitment: "red" };
const byId = (items: Evidence[]) => Object.fromEntries(items.map(e => [e.id, e]));
type Drawer = { title: string; items: Evidence[] };

export default function Analyst() {
  const [state, dispatch] = useReducer(reduce, idle);
  const [question, setQuestion] = useState("");
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const running = state.status === "running";
  const open = (e: Evidence) => setDrawer({ title: `Evidence ${e.id}`, items: [e] });
  async function ask(text: string) {
    const q = text.trim();
    if (!q || running) return;
    const active = new AbortController();
    controller.current = active;
    dispatch({ type: "ask", question: q });
    setQuestion("");
    try {
      // POST + ReadableStream, since EventSource cannot send a body.
      const response = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, session_id: state.session_id }), signal: active.signal });
      if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream"))
        return dispatch(httpFailure(response.status, await response.json().catch(() => null)));
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSSE(buffer + value);
        buffer = parsed.rest;
        parsed.events.forEach(dispatch);
      }
      dispatch({ type: "closed" });
    } catch (e) {
      if (!active.signal.aborted) dispatch({ type: "error", code: "upstream", message: e instanceof Error ? e.message : "The analyst stream failed." });
    }
  }
  const [tone, hint] = state.error ? failures[state.error.code] ?? failures.upstream : ["", ""];
  const evidence = Object.values(state.evidence);
  const u = state.usage;
  return <div className="analyst-grid">
    <div>
      <Panel title="Ask" subtitle="Claude investigates with Rooted's tools and the live node, and is told to cite the tool result behind every figure.">
        <form className="analyst-form" onSubmit={e => { e.preventDefault(); void ask(question); }} aria-busy={running}>
          <label htmlFor="analyst-question">Question</label>
          <textarea id="analyst-question" value={question} rows={3} maxLength={2000} disabled={running} aria-describedby="analyst-help"
            placeholder="Ask about a Sepolia block, slot, builder or frame transaction…"
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); } }} />
          <div className="analyst-form-row">
            <p id="analyst-help">Enter asks, Shift+Enter adds a line. {state.session_id ? "Follow-ups keep this session's context." : "Up to 12 model steps and 3 actions per question."}</p>
            {state.session_id && <button type="button" disabled={running} onClick={() => dispatch({ type: "reset" })}>New session</button>}
            <button className="primary" disabled={running || !question.trim()}><Send size={14} />{running ? "Investigating…" : "Ask"}</button>
          </div>
          <div className="analyst-suggestions" role="group" aria-label="Suggested questions">
            {suggestions.map(s => <button type="button" key={s} disabled={running} onClick={() => void ask(s)}>{s}</button>)}
          </div>
        </form>
      </Panel>
      {state.status !== "idle" && <Panel className="analyst-run" title="Investigation" subtitle={state.question}
        action={<Badge tone={running ? "blue" : state.status === "done" ? "green" : tone}>{running ? "RUNNING" : state.status === "done" ? "ANSWERED" : "STOPPED"}</Badge>}>
        {state.steps.length > 0 && <ol className="analyst-trace" aria-label="Tool calls">
          {state.steps.map(step => <TraceRow key={step.id} step={step} running={running} onOpen={open} />)}
        </ol>}
        {state.thinking && <p className="analyst-thinking"><Brain size={13} aria-hidden /><span>{state.thinking.trim().split(/\n+/).at(-1)}</span></p>}
        {(running || state.answer) && <section className="analyst-answer" aria-label="Answer" aria-live="polite" aria-busy={running}>
          {state.answer ? <Cited text={state.answer} evidence={state.evidence} onOpen={open} /> : <span className="muted">Investigating<span className="dots">…</span></span>}
        </section>}
        {state.error && <div className={"notice " + (tone === "amber" ? "warning" : tone === "red" ? "error" : "")} role="alert">
          <Badge tone={tone}>{state.error.code.replace("_", " ").toUpperCase()}</Badge>
          <span>{state.error.message || hint}</span>
        </div>}
        {(u || evidence.length > 0) && <div className="panel-footer analyst-usage">
          <span>{u ? `$${u.usd.toFixed(4)} · ${u.input.toLocaleString()} input · ${u.output.toLocaleString()} output · ${u.cache_read.toLocaleString()} cache read · ${u.cache_write.toLocaleString()} cache write tokens` : "Usage arrives with the answer."}</span>
          {evidence.length > 0 && <button className="text-button" onClick={() => setDrawer({ title: "All evidence", items: evidence })}>All evidence ({evidence.length})</button>}
        </div>}
      </Panel>}
    </div>
    <Briefs onOpen={setDrawer} />
    {drawer && <EvidenceDrawer {...drawer} onClose={() => setDrawer(null)} />}
  </div>;
}

function TraceRow({ step, running, onOpen }: { step: Step; running: boolean; onOpen: (e: Evidence) => void }) {
  const r = step.result;
  const input = JSON.stringify(step.input ?? {});
  return <li className={r && !r.ok ? "failed" : ""}>
    <span className="analyst-step-state">{r ? <span className="mono">{ms(r.ms)}</span>
      : running ? <LoaderCircle size={14} className="analyst-spin" role="img" aria-label="Running" /> : <span className="muted">no result</span>}</span>
    <div>
      <code className="analyst-tool">{step.tool}</code>
      {step.action && <Badge tone="amber">ACTION</Badge>}
      {step.tool === "buy_xray_report" && <Badge tone="red">PAYMENT</Badge>}
      {input !== "{}" && <code className="analyst-input" title={input}>{input}</code>}
      {r?.note && <small>{r.ok ? "" : "Failed: "}{r.note}</small>}
    </div>
    {r?.evidence && <Cite e={r.evidence} onOpen={onOpen} />}
  </li>;
}

function Cite({ e, onOpen }: { e: Evidence; onOpen: (e: Evidence) => void }) {
  return <button type="button" className="analyst-cite" onClick={() => onOpen(e)} aria-label={`Evidence ${e.id}: ${e.label}`}>{e.id}</button>;
}

function Cited({ text, evidence, onOpen }: { text: string; evidence: Record<string, Evidence>; onOpen: (e: Evidence) => void }) {
  return <>{citations(text).map((part, i) => typeof part === "string" ? part
    : evidence[part.cite] ? <Cite key={i} e={evidence[part.cite]} onOpen={onOpen} />
      : <span key={i} className="analyst-cite" title="Evidence not received">{part.cite}</span>)}</>;
}

function Briefs({ onOpen }: { onOpen: (d: Drawer) => void }) {
  const [feed, setFeed] = useState<{ data?: Brief[]; error?: string }>({});
  useEffect(() => {
    let stopped = false;
    const load = () => fetch("/api/analyst/briefs", { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error?.message || `Briefs HTTP ${r.status}`);
        if (!stopped) setFeed({ data: body.data as Brief[] });
      })
      .catch(e => { if (!stopped) setFeed(old => ({ data: old.data, error: e instanceof Error ? e.message : "Briefs unavailable" })); });
    void load();
    const timer = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return <Panel className="analyst-briefs" title="Briefs" subtitle="Written automatically for blocks that trip a rule · refreshed every 15 s">
    {feed.error && <div className="notice error" role="alert">{feed.error}{feed.data && " Showing the last successful response."}</div>}
    {!feed.data && !feed.error && <div className="notice loading">Retrieving briefs<span className="dots">…</span></div>}
    {feed.data?.length === 0 && <div className="notice"><span>No briefs yet. <code>npm run briefs</code> writes one when a recent block trips an anomaly rule.</span></div>}
    {!!feed.data?.length && <ul className="analyst-brief-list">{feed.data.map(b => { const evidence = evidenceList(b.evidence); return <li key={b.block_hash}>
      <div className="analyst-brief-head"><strong>Block {b.block_number.toLocaleString()}</strong><small>{age(b.created_at)}</small></div>
      <div className="analyst-badges">{b.triggers.map(t => <Badge key={t} tone={triggerTone[t]}>{t.replace("_", " ")}</Badge>)}</div>
      {firstLines(b.brief).map((line, i) => <p key={i}><Cited text={line} evidence={byId(evidence)} onOpen={e => onOpen({ title: `Evidence ${e.id}`, items: [e] })} /></p>)}
      <div className="analyst-brief-links">
        <a className="text-button" href={`/?view=xray&block=${b.block_hash}`} target="_blank" rel="noreferrer">X-ray<ExternalLink size={12} /></a>
        <button className="text-button" onClick={() => onOpen({ title: `Brief evidence · block ${b.block_number.toLocaleString()}`, items: evidence })}>Evidence ({evidence.length})</button>
      </div>
    </li>; })}</ul>}
  </Panel>;
}

function EvidenceDrawer({ title, items, onClose }: Drawer & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="analyst-drawer" aria-label={title} onCancel={onClose}>
    <div className="dialog-heading">
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close evidence"><X size={20} /></button>
    </div>
    {items.length ? items.map(e => {
      const link = safeLink(e.link);
      return <article key={e.id}>
        <div className="analyst-badges"><Badge tone="blue">{e.id}</Badge><Badge>{e.kind.replaceAll("_", " ")}</Badge></div>
        <h3>{e.label}</h3>
        {link ? <a className="text-button" href={link} title={link} target="_blank" rel="noreferrer">{link.startsWith("/") ? "Open in Rooted" : `Open on ${link.split("/")[2]}`}<ExternalLink size={12} /></a> : <span className="muted small">No link for this evidence.</span>}
        <dl>
          <dt>sha256 of the raw tool result</dt><dd><code>{e.sha256}</code></dd>
          <dt>Recorded</dt><dd>{e.at}</dd>
        </dl>
      </article>;
    }) : <p className="muted">No evidence recorded.</p>}
  </dialog>;
}
