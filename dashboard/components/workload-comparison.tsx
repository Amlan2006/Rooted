"use client";
import { useState } from "react";
import { comparisonIssues, parseComparison, workloadMetrics, type Comparison } from "@/lib/workload-comparison";
import { short } from "@/lib/data";
import { Badge, Evidence, Panel } from "./ui";

export default function WorkloadComparison() {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [projection, setProjection] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function load(text: string) {
    setComparison(null); setError("");
    try { setComparison(parseComparison(text)); } catch (e) { setError(e instanceof Error ? e.message : "Invalid comparison."); }
  }
  async function example() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/examples/workload-comparison.json");
      if (!response.ok) throw new Error("Recorded example unavailable. Generate and open your own comparison.json.");
      load(await response.text());
    } catch (e) { setError(e instanceof Error ? e.message : "Example unavailable."); }
    finally { setBusy(false); }
  }
  const issues = comparison ? comparisonIssues(comparison, projection) : [];
  const results = comparison?.scenarios.map(s => workloadMetrics(s.report, projection));
  return <>
    <Panel title="Compare controlled workloads" subtitle="Recorded local Sepolia fork experiments · simulated funds · no public transactions">
      <div className="analysis-form">
        <p>Compare three swaps through one pool (A/A/A) with the same swaps routed A/B/A. Start from the same prepared state, accounts, amounts, order, and gas settings.</p>
        <div className="comparison-controls">
          <button className="primary" disabled={busy} onClick={example}>{busy ? "Loading…" : "Load recorded experiment"}</button>
          <label>Open comparison JSON<input type="file" accept=".json,application/json" onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return;
            setComparison(null);
            if (file.size > 8_000_000) { setError("Comparison file exceeds 8 MB."); return; }
            try { load(await file.text()); } catch { setError("Cannot read comparison file."); }
            e.target.value = "";
          }} /></label>
        </div>
        <p>Generate a new pair with <code>python3 scripts/run_uniswap_comparison.py</code>. See <code>docs/WORKLOAD_COMPARISON.md</code>. Files are read in this browser.</p>
        {error && <div className="notice error" role="alert">{error}</div>}
      </div>
    </Panel>
    {comparison && results && <>
      <div className="notice"><Badge tone="amber">Recorded fork experiment</Badge> Captured {comparison.captured_at}. These are saved observations; the experiment node may already be stopped.</div>
      <Panel title="Comparison scope" subtitle="Deltas require matching identities, successful swaps, trace availability, coverage, and an untruncated graph." action={<Evidence value={comparison} label="Comparison evidence" />}>
        <div className="analysis-form">
          <p>Fork {comparison.fork?.number} · {short(comparison.fork?.hash)}. Prepared baseline {short(comparison.baseline?.hash)}.</p>
          <label>State scope <select value={projection ? "storage" : "all"} onChange={e => setProjection(e.target.value === "storage")}>
            <option value="all">All observed state · includes account effects</option>
            <option value="storage">Storage only · excludes balance, nonce, and code effects</option>
          </select></label>
          {issues.length ? <div className="notice error"><div><strong>Comparison unavailable; scenario counts remain visible.</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div></div> : <p><Badge tone="green">Comparable observed evidence</Badge> Matching coverage does not establish complete dependency coverage.</p>}
          <p>Pool fees and liquidity differ between routes. Depth and width describe the observed graph with unit-cost transactions. They do not measure execution time, speedup, or prove that different pools are independent.</p>
        </div>
      </Panel>
      <Panel title="Observed dependency comparison" subtitle="Delta = spread pools minus same pool; negative counts mean fewer observed edges, not faster execution.">
        <div className="table-wrap"><table><thead><tr><th>Metric</th><th>{comparison.scenarios[0].name}</th><th>{comparison.scenarios[1].name}</th><th>Delta</th></tr></thead>
          <tbody>{results[0].metrics.map((metric, i) => <tr key={metric.label}><td>{metric.label}</td><td>{metric.value}</td><td>{results[1].metrics[i].value}</td><td>{issues.length ? "Withheld" : results[1].metrics[i].value - metric.value}</td></tr>)}</tbody>
        </table></div>
      </Panel>
      <div className="comparison-grid">{comparison.scenarios.map((s, index) => <Panel key={s.report.id} title={s.name} subtitle={`Report ${short(s.report.id)} · block ${short(s.report.block.hash)}`}>
        <div className="analysis-form">
          <p>Pool route: {s.routes.map(short).join(" → ")}</p>
          <p>Coverage: {results[index].graph.full_dependency_coverage ? "complete for supplied evidence" : "partial"}; {results[index].graph.edges.length} returned edges.</p>
          <details><summary>Transaction identities and coverage</summary><ol>{s.transactions.map((tx, i) => <li key={tx}><code>{tx}</code><br />Pool {s.routes[i]} · receipt {s.receipts[i]?.status}</li>)}</ol><p>{[...s.report.coverage, ...results[index].graph.coverage].join(", ") || "No coverage notes"}</p></details>
          <h3>Top exact-location hotspots</h3>
          {results[index].breakdown.hotspots.slice(0, 5).map(h => <p key={h.id}><code>{short(h.location.address)} · {h.location.field} {short(h.location.key)}</code><br />{h.count} edges · {h.category}</p>)}
          {!results[index].breakdown.hotspots.length && <p>No observed conflicts.</p>}
          <p>Showing first 5 ranked locations; full keys, inputs, and graphs are in comparison evidence.</p>
        </div>
      </Panel>)}</div>
    </>}
  </>;
}
