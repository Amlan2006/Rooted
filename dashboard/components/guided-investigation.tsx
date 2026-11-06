"use client";
import { useCallback, useEffect, useState } from "react";
import type { Run } from "@/lib/data";
import { ms, short, verdict } from "@/lib/data";
import { useResource } from "@/lib/hooks";
import { asRecord, collectInvestigationLinks, type LinkedEvidence } from "@/lib/investigation-links";
import { investigationURL, matchesInvestigation, parseInvestigationSelection, payloadTimeline, reportPath, selectionForRun, type InvestigationSelection } from "@/lib/guided-investigation";
import AnalysisForm from "./analysis-form";
import Dependencies from "./dependencies";
import { Badge, Evidence, Notice, Panel } from "./ui";

const label = (value: unknown) => value == null ? "Unknown" : String(value);
const stateLabels = { matched: "Matched evidence", not_found_in_search: "No match in bounded search", unavailable: "Evidence unavailable", unsupported_scope: "Unsupported observation scope" };
function PayloadEvidence({ run, payload }: { run: Run; payload: Record<string, unknown> }) {
  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof payloadTimeline>> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void payloadTimeline(run, payload, async path => {
      const response = await fetch("/api/backend" + path, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error("Timeline unavailable");
      return response.json();
    }).then(result => { if (!controller.signal.aborted) setTimeline(result); });
    return () => controller.abort();
  }, [run, payload]);
  return <article className="guided-payload">
    <h3>Slot {label(payload.slot)} · {label(payload.source_id)}</h3>
    <dl className="guided-identities"><dt>Beacon root</dt><dd><code>{label(payload.block_root)}</code></dd><dt>Execution hash</dt><dd><code>{label(payload.payload_hash)}</code></dd></dl>
    <div className="guided-facts"><span>Collector receipt difference: <strong>{ms(typeof payload.reveal_latency_ms === "number" ? payload.reveal_latency_ms : null)}</strong></span><span>Canonical: {verdict(typeof payload.canonical === "boolean" ? payload.canonical : null)}</span><span>Execution validation (source-reported): {verdict(typeof payload.execution_valid === "boolean" ? payload.execution_valid : null)}</span></div>
    <p>Timing describes the collector’s observation path. It is not global propagation time or a protocol timeliness verdict. Missing timing remains unknown.</p>
    <Evidence value={payload} label={`Payload evidence for slot ${label(payload.slot)}`} />
    {!timeline ? <p role="status">Loading matching journal events…</p> : <>
      <p>{timeline.status === "matched" ? `${timeline.events.length} matching journal events; showing ${Math.min(12, timeline.events.length)} (first ${timeline.limit} entries searched).` : timeline.status === "unavailable" ? "Journal unavailable. The matched payload observation remains usable." : `No matching journal events in the first ${timeline.limit} entries.`}</p>
      {timeline.events.length > 0 && <div className="table-scroll"><table><thead><tr><th>Event</th><th>Observed at</th><th>Timed receipt</th></tr></thead><tbody>{timeline.events.slice(0, 12).map((entry, index) => { const event = asRecord(entry.event); return <tr key={index}><td>{label(event.kind)}</td><td>{label(event.observed_at)}</td><td>{event.timed === true ? "Yes" : event.timed === false ? "No" : "Unknown"}</td></tr>; })}</tbody></table></div>}
      {timeline.events.length > 0 && <Evidence value={timeline.events} label={`Matching journal evidence for slot ${label(payload.slot)}`} />}
    </>}
  </article>;
}
function LinkedStages({ run, source, onSource, children }: { run: Run; source: string | null; onSource: (source: string) => void; children: React.ReactNode }) {
  const [links, setLinks] = useState<LinkedEvidence | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); const timeout = AbortSignal.timeout(30000);
    setLinks(null);
    void collectInvestigationLinks(run, async path => {
      const response = await fetch("/api/backend" + path, { cache: "no-store", signal: AbortSignal.any([controller.signal, timeout, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error("Linked evidence unavailable");
      return response.json();
    }, source || undefined).then(result => {
      if (!controller.signal.aborted) { setLinks(result); if (result.source) onSource(result.source); }
    });
    return () => controller.abort();
  }, [run, retry, source, onSource]);
  return <>
    <Panel id="investigation-payload" title="2. Payload delivery" subtitle="Correlated by execution hash, network, mode, source, slot, and Beacon root">
      {!links ? <div className="notice" role="status">Checking stored payload and policy evidence…</div> : <>
        <div className="guided-status"><Badge tone={links.payloadStatus === "matched" ? "green" : "amber"}>{stateLabels[links.payloadStatus]}</Badge><button onClick={() => setRetry(value => value + 1)}>Recheck linked evidence</button></div>
        {links.payloads.length > 1 && <div className="notice warning">Multiple matching Beacon-root observations. Each is shown separately; no canonical root is inferred or chosen automatically.</div>}
        {links.payloads.length === 0 && <div className="notice">{links.payloadStatus === "unsupported_scope" ? "The observation search currently supports live Sepolia only. This report keeps its original mode and remains available below." : "No matching payload observation is available in this search. State analysis can still be inspected; delivery timing remains unknown."}</div>}
        {links.payloads.slice(0, 8).map(payload => <PayloadEvidence key={`${payload.source_id}:${payload.slot}:${payload.block_root}`} run={run} payload={payload} />)}
        {links.payloads.length > 8 && <p className="footnote">Showing 8 of {links.payloads.length} matching observations. All matches remain available in exports.</p>}
        <p className="footnote">Payload source: {links.source || "Unknown"}. Only this pinned source is searched: at most 200 observations, using the header slot when available. Missing results do not establish that no evidence exists.</p>
      </>}
    </Panel>
    {children}
    <Panel id="investigation-policy" title="5. Related CRE policy checks" subtitle="Window-level checks containing an explicitly matched payload observation">
      {!links ? <div className="notice" role="status">Checking stored policy summaries…</div> : <>
        <div className="guided-status"><Badge tone={links.policyStatus === "matched" ? "blue" : "amber"}>{stateLabels[links.policyStatus]}</Badge></div>
        {links.policies.length === 0 && <div className="notice">No related policy check is established here. This is not a healthy or unhealthy verdict about the transaction.</div>}
        {links.policies.slice(0, 10).map(({ report, summary }) => { const policy = asRecord(report.policy); const decision = asRecord(report.decision); return <article className="guided-payload" key={String(report.id)}>
          <h3>{label(decision.outcome)} · {label(report.execution_mode)}</h3><p>Report <code>{label(report.id)}</code></p>
          <p>Observation scope: {label(report.network)} / {label(report.mode)} / {label(report.source)}.</p>
          <p>Policy network: {label(policy.policy_network)} · chain {label(policy.policy_chain_id)} · contract <code>{label(policy.contract)}</code>.</p>
          <p>Summary <code>{label(summary.id)}</code> contains the matched payload observation. This decision applies to that observation window, not to this individual transaction.</p>
          <p>Authentication: {label(report.authentication)}. Simulation is not DON-signed production execution.</p>
          <Evidence value={{ report, summary, search_bounds: links.search }} label={`Policy and summary evidence ${short(String(report.id))}`} />
        </article>; })}
        {links.policies.length > 10 && <p className="footnote">Showing 10 of {links.policies.length} matched checks. Exports include all matches from the bounded search.</p>}
        <p className="footnote">Search limits: {links.search.policyLimit} reports and {links.search.summaryLimit} distinct summaries. Summary fetch failures: {links.search.summaryFailures}.</p>
      </>}
    </Panel>
  </>;
}
export default function GuidedInvestigation({ onScope }: { onScope: (scope: { network: string; chain_id: string } | null) => void }) {
  const [selection, setSelection] = useState<InvestigationSelection | null>(null);
  const [direct, setDirect] = useState<Run | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { try { setSelection(parseInvestigationSelection(new URLSearchParams(location.search))); } catch (error) { setError((error as Error).message); } }, []);
  const stored = useResource<{ data: Run }>(selection ? reportPath(selection) : null, 0, 30000);
  const latest = useResource<{ data: Run[] }>(!selection && !error ? "/api/v1/analysis/runs?network=sepolia&mode=live&limit=1" : null, 0, 30000);
  const pinSource = useCallback((source: string) => setSelection(previous => previous && previous.source === null ? { ...previous, source } : previous), []);
  useEffect(() => { if (selection) history.replaceState(null, "", investigationURL(selection)); }, [selection]);
  const candidate = direct || stored.data?.data;
  const run = candidate && selection && matchesInvestigation(candidate, selection) ? candidate : null;
  useEffect(() => { onScope(run ? { network: run.network, chain_id: run.chain_id } : null); return () => onScope(null); }, [run?.network, run?.chain_id, onScope]);
  const open = (report: Run) => {
    try { const next = selectionForRun(report); setDirect(report); setSelection(next); setError(""); history.replaceState(null, "", investigationURL(next)); }
    catch (error) { setError((error as Error).message); }
  };
  const focus = run && selection?.transaction ? run.block.transactions.findIndex(tx => tx.hash.toLowerCase() === selection.transaction) : null;
  return <>
    <AnalysisForm transactionOnly onComplete={open} />
    {!selection && !error && <div className="notice">You can also investigate saved evidence without collecting new chain data. <button disabled={!latest.data?.data[0]} onClick={() => latest.data?.data[0] && open(latest.data.data[0])}>Open latest saved report</button>{latest.error && <span> Saved reports are unavailable: {latest.error}</span>}</div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {selection && !direct && <Notice resource={stored} />}
    {candidate && selection && !run && <div className="notice error" role="alert">The report, network, mode, or transaction does not match this investigation link. No cross-module attribution was made.</div>}
    {run && selection && <>
      <nav className="investigation-steps" aria-label="Investigation steps"><a href="#investigation-identities">1 Transaction & block</a><a href="#investigation-payload">2 Payload delivery</a><a href="#state-dependencies">3 Shared state</a><a href="#uniswap-results">4 Swaps</a><a href="#investigation-policy">5 Policy checks</a><a href="#investigation-download">6 Export</a></nav>
      <Panel id="investigation-identities" title="1. Transaction and execution block" subtitle="A pinned report with explicit immutable identities">
        <dl className="guided-identities"><dt>Transaction</dt><dd><code>{selection.transaction || "No transaction selected; block-wide analysis"}</code></dd><dt>Execution block</dt><dd><code>{run.block.hash}</code></dd><dt>Report</dt><dd><code>{run.id}</code></dd><dt>Network / mode / chain</dt><dd>{run.network} / {run.mode} / {run.chain_id}</dd></dl>
        <p className="footnote">Transaction index: {focus == null ? "not selected" : focus} (zero-based). Tracing is {selection.transaction && run.analyzed_transactions?.some(tx => tx.transaction.hash.toLowerCase() === selection.transaction) ? "selected for this transaction; see report-specific coverage" : "not established for this transaction"}. Analyzed {run.created_at}. Canonical at fetch: {verdict(run.canonical_at_fetch)}.</p>
        <Evidence value={{ report: run.id, block: run.block.hash, selection, analyzed_at: run.created_at, coverage: run.coverage }} label="Investigation identity and scope" />
      </Panel>
      <LinkedStages key={`${run.id}:${run.created_at}`} run={run} source={selection.source} onSource={pinSource}>
        <div className="notice">3–4. Inspect shared-state conflicts and swap outcomes below. Missing delivery or policy evidence does not stop this investigation.</div>
        <Dependencies key={`${run.id}:${run.created_at}:${focus}`} run={run} initialFocus={focus} linkedSource={selection.source} />
      </LinkedStages>
    </>}
  </>;
}
