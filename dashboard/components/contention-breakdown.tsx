"use client";
import { useMemo } from "react";
import type { Graph, Run } from "@/lib/data";
import { short } from "@/lib/data";
import { contentionBreakdown, contentionCategories } from "@/lib/contention";
import { Badge, Evidence, Panel } from "./ui";

export default function ContentionBreakdown({ run, graph, projection, focus }: {
  run: Run; graph: Graph; projection: boolean; focus: number | null;
}) {
  const result = useMemo(() => contentionBreakdown(run, graph, focus), [run, graph, focus]);
  const evidence = { report_id: run.id, block_hash: run.block.hash, network: run.network, mode: run.mode, analyzed_at: run.created_at,
    scope: projection ? "storage_projection" : "all_known_state", transaction_filter: focus, traced_transactions: run.analyzed_transactions?.map(tx => tx.transaction.hash) ?? null,
    denominator: result.total, returned_graph_edges: result.graphTotal, categories: result.categories, locations: result.hotspots,
    cross_pool_evidence: result.crossPool, graph_truncated: graph.truncated ?? null, graph_coverage: graph.coverage, report_coverage: run.coverage,
    full_dependency_coverage: graph.full_dependency_coverage, storage_read_coverage_complete: graph.storage_read_coverage_complete,
    classification: "account fields first; storage in verified pools; storage at token addresses from verified pools; otherwise unclassified", sources: run.sources };
  return <Panel title="Uniswap contention breakdown" subtitle="Where the returned location-level conflict edges occur" action={<Evidence label="Contention evidence" value={evidence} />}>
    <div className="contention-context">
      <strong>{result.total.toLocaleString()} location-level conflict edges</strong>
      <span>{projection ? "Storage projection" : "All known state"} · {focus == null ? "All transactions in this block" : `Edges involving transaction ${focus}`} · {result.graphTotal.toLocaleString()} edges in the returned graph</span>
      <span>{run.network} · {run.mode} · {run.analyzed_transactions ? `${run.analyzed_transactions.length} transaction(s) selected for tracing` : "Trace selection unknown"}</span>
      <span>Transaction storage-read coverage: {graph.storage_read_coverage_complete ? "complete as reported" : "incomplete"}</span>
      <Badge tone={graph.truncated === false ? "neutral" : "amber"}>{graph.truncated === true ? "Graph truncated" : graph.truncated === false ? "Returned graph not truncated" : "Truncation unknown"}</Badge>
    </div>
    <div className="contention-categories">
      {result.categories.map(category => <div key={category.id}>
        <span>{category.label}</span><strong>{category.count.toLocaleString()}</strong>
        <small>{category.share == null ? "No denominator" : `${(category.share * 100).toFixed(1)}% of ${result.total.toLocaleString()} edges`}</small>
        <meter min={0} max={Math.max(1, result.total)} value={category.count} aria-label={`${category.label}: ${category.count} of ${result.total} edges`} />
      </div>)}
    </div>
    <p className="footnote">Each edge belongs to one category. Counts cover the selected returned edge set, including edges beyond the 60-row conflict table and the 12-node map. They count location-level dependencies, not unique transaction pairs or execution time.</p>
    <p className="footnote">{projection ? "Balance, nonce, code, and fee-recipient account effects are excluded from this projection." : "Balance, nonce, and code overlaps are shared account effects, including any fee-recipient effects represented in this graph."} Token identity comes from verified pool metadata; it does not identify the meaning of a token storage key.</p>
    {result.total === 0 ? <div className="notice">No conflict edges in this selection. Incomplete evidence does not establish transaction independence.</div> : <>
      <h3 className="contention-heading">Most frequent shared locations</h3>
      <p className="footnote">Showing {Math.min(8, result.hotspots.length)} of {result.hotspots.length} exact locations, ranked by edge count. Reader and writer counts are derived only from these edges.</p>
      <div className="table-scroll"><table><thead><tr><th>Category / exact location</th><th>Edges</th><th>Readers / writers</th><th>Transaction indexes</th></tr></thead><tbody>
        {result.hotspots.slice(0, 8).map(hotspot => <tr key={hotspot.id}>
          <td>{contentionCategories.find(category => category.id === hotspot.category)!.label}<br /><code title={hotspot.location.address}>{short(hotspot.location.address)}</code><br /><code title={hotspot.location.key}>{hotspot.location.field}{hotspot.location.key ? ` · ${short(hotspot.location.key)}` : ""}</code></td>
          <td>{hotspot.count}</td><td>{hotspot.readers.length} / {hotspot.writers.length}</td>
          <td><span title={hotspot.transactions.join(", ")}>{hotspot.transactions.slice(0, 8).join(", ")}{hotspot.transactions.length > 8 ? ` +${hotspot.transactions.length - 8}` : ""}</span></td>
        </tr>)}
      </tbody></table></div>
    </>}
    <h3 className="contention-heading">Different pools, shared token state</h3>
    {result.crossPool.length ? <>
      <p className="footnote">{result.crossPool.length} corroborated token-storage edge(s) link transactions with committed swaps in different verified pools. Showing the first {Math.min(5, result.crossPool.length)}. Each transaction may also touch other pools.</p>
      {result.crossPool.slice(0, 5).map((finding, index) => <div className="cross-pool-finding" key={index}>
        <p>Transaction {finding.edge.from} has a committed swap in pool <code>{short(finding.poolAddresses[0])}</code>; transaction {finding.edge.to} has one in <code>{short(finding.poolAddresses[1])}</code>.</p>
        <p>The stored <strong>{finding.edge.kind}</strong> edge involves the same storage key <code title={finding.edge.location.key}>{short(finding.edge.location.key)}</code> in token contract <code title={finding.edge.location.address}>{short(finding.edge.location.address)}</code>.</p>
        <Evidence label={`Cross-pool evidence ${index + 1}`} value={{ report_id: run.id, network: run.network, mode: run.mode, ...finding }} />
      </div>)}
    </> : <p className="footnote">No corroborated cross-pool token-storage conflict in this selection. Shared token addresses alone are not proof of a conflict, and missing traces do not establish independence.</p>}
    <div className="panel-footer"><span>{graph.full_dependency_coverage ? "Dependency coverage marked complete by this report." : "Partial dependency coverage; additional conflicts may be missing."} No execution-time savings are inferred.</span></div>
  </Panel>;
}
