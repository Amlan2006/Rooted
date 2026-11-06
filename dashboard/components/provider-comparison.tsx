"use client";
import { useState } from "react";
import { useResource } from "@/lib/hooks";
import { short } from "@/lib/data";
import { parseProviderRequest } from "@/lib/provider-request";
import { Badge, Evidence, Notice, Panel } from "./ui";
type Check = { method: string; identity: string; status: string; observed_at: string; http_status?: number; rpc_code?: number; response_digest?: string; data?: unknown };
type Observation = { provider: string; execution_source_id: string; beacon_source_id: string; network_verified: boolean; checks: Check[]; header?: unknown };
type Report = { id: string; network: string; mode: string; block_hash: string; created_at: string; status: string; observations: Observation[]; findings: { code: string; detail: string }[] };
const statusText = (s: string) => s === "consistent_observed_data" ? "Matching observed data" : s === "matching_block_with_observation_gaps" ? "Matching block data; observation gaps" : s === "disagreement_requires_investigation" ? "Returned evidence needs investigation" : "Incomplete observations";
export default function ProviderComparison() {
  const [hash, setHash] = useState("");
  const [selected, setSelected] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reports = useResource<{data: Report[]}>("/api/v1/providers/comparisons?network=sepolia", 0, 30000);
  const report = selected || reports.data?.data[0];
  async function compare(blockHash: string) {
    setError(""); let input;
    try { input = parseProviderRequest({block_hash:blockHash}); } catch(e) { setError(e instanceof Error ? e.message : "Invalid hash"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/provider-comparison", { method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(90000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Comparison failed.");
      setSelected(body.data); setHash(body.data.block_hash); reports.refresh();
    } catch(e) { setError(e instanceof Error ? e.message : "Comparison failed. Check backend and providers, then retry."); }
    finally { setBusy(false); }
  }
  function download(r: Report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r,null,2)+"\n"],{type:"application/json"}));
    const anchor = document.createElement("a"); anchor.href=url; anchor.download=`rooted-providers-${r.id.slice(2,14)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    <Panel title="Compare the same execution block" subtitle="Live, read-only probes of two operator-configured Sepolia providers">
      <form className="analysis-form" onSubmit={e=>{e.preventDefault();void compare(hash);}} aria-busy={busy}>
        <div className="analysis-inputs transaction-only"><label>Execution block hash (optional)<input value={hash} onChange={e=>setHash(e.target.value)} placeholder="0x… or leave empty for primary finalized block" disabled={busy} /></label><button type="submit" disabled={busy}>{busy?"Comparing…":"Compare providers"}</button></div>
        <p>An empty hash selects the primary provider’s finalized block once. Both providers then receive that same hash. Each check is saved separately with its timestamp and response digest. Provider URLs stay in server configuration.</p>
        {error && <div className="notice error" role="alert">{error}</div>}
      </form>
    </Panel>
    <Notice resource={reports} />
    {!!reports.data?.data.length && <div className="notice"><label>Saved checks <select value={report?.id||""} onChange={e=>setSelected(reports.data!.data.find(r=>r.id===e.target.value)||null)}>{reports.data.data.map(r=><option value={r.id} key={r.id}>{r.created_at} · {short(r.block_hash)} · {statusText(r.status)}</option>)}</select></label></div>}
    {report && <>
      <Panel className="provider-summary" title={statusText(report.status)} subtitle={`Sepolia · live observations · ${report.created_at}`} action={<Evidence value={report} label="Comparison evidence" />}>
        <div className="analysis-form"><p>Block <code>{report.block_hash}</code><br />Saved check <code>{report.id}</code></p>
          <div className="comparison-controls"><button className="primary" disabled={busy} onClick={()=>void compare(report.block_hash)}>Recheck this same block</button><button onClick={()=>download(report)}>Download saved comparison</button></div>
          <p>A recheck creates another saved observation. Unsupported methods, missing/pruned history, rate limits, and connection failures do not establish contradictory chain data. No provider is automatically declared correct; matching selected fields is not a full consensus or cryptographic header validation.</p>
          <ul>{report.findings.map((f,i)=><li key={`${f.code}-${i}`}><strong>{f.code.replaceAll("_"," ")}</strong>: {f.detail}</li>)}</ul>
        </div>
      </Panel>
      <div className="comparison-grid">{report.observations.map(o=><Panel className="provider-check-panel" title={o.provider === "primary" ? "Primary provider" : "Reference provider"} key={o.provider} subtitle={`Execution source ${short(o.execution_source_id)} · Beacon source ${short(o.beacon_source_id)}`} action={<Badge tone={o.network_verified?"green":"amber"}>{o.network_verified?"Execution network verified":"Execution network unverified"}</Badge>}>
        <div className="table-wrap"><table><thead><tr><th>Read / capability</th><th>Observation</th></tr></thead><tbody>{o.checks.map((c,i)=><tr key={i}><td><code>{c.method}</code><br /><small>{short(c.identity)}</small></td><td><Badge tone={c.status==="available"?"green":c.status.includes("mismatch")?"red":"amber"}>{c.status.replaceAll("_"," ")}</Badge><br /><small>{c.observed_at}<br />{c.http_status?`HTTP ${c.http_status}`:""}{c.rpc_code!=null?` · RPC ${c.rpc_code}`:""}</small><br /><Evidence value={c} label="Check evidence" /></td></tr>)}</tbody></table></div>
      </Panel>)}</div>
    </>}
  </>;
}
