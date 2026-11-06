"use client";
import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { useResource } from "@/lib/hooks";
import { age, short, verdict, type Frame } from "@/lib/data";
import { divergent, explorerTx, matches, parseConformance, sources } from "@/lib/frame-conformance";
import { Badge, Evidence, Notice, Panel } from "./ui";

// The own-tx panel reads the scope of the node that received the conformance run (results.node; the gateway never relays).
const ownScope = (node: string) => `network=frame-devnet&mode=live&node=${node}`;
const labels = { eip8141: "EIP-8141", eip8250: "EIP-8250", erc8421_draft: "ERC-8421 draft", sidecar_docs: "Sidecar docs" };
const tone = (v: string) => (v === "accept" ? "green" : v === "reject" ? "red" : "neutral");
type Submission = { attempt_id: string; expected_hash: string; submitted_at: string; submission_status: string };

export default function FrameConformance({ scope }: { scope: string }) {
  // No node param: the API joins archive_status from the scope of the node that received the cases (results.node).
  const results = useResource<{ data: unknown }>(`/api/v1/frames/conformance?${scope.replace(/&node=\w+/, "")}`, 0, 60000);
  const [run, invalid] = useMemo(() => {
    try { return [results.data ? parseConformance(results.data.data) : null, ""]; } catch (e) { return [null, e instanceof Error ? e.message : "Invalid results"]; }
  }, [results.data]);
  const node = run ? (run.node === "miner" ? "miner" : "gateway") : results.error || invalid ? "gateway" : null;
  const ownQuery = node && ownScope(node);
  const submissions = useResource<{ data: Submission[] }>(ownQuery ? `/api/v1/frames/submissions?${ownQuery}&limit=50` : null, 0, 30000);
  const own = submissions.data?.data.find(s => s.submission_status === "submission_acknowledged");
  const tx = useResource<{ data: Frame[] }>(own ? `/api/v1/frames/transactions/${own.expected_hash}?${ownQuery}` : null, 0, 30000);
  const state = tx.data?.data[0];
  return <>
    <Panel title="Own admitted transaction" subtitle="Latest acknowledged Rooted submission, joined with its archived lifecycle" action={node && <Badge tone="blue">{node.toUpperCase()} · CHAIN 1337</Badge>}>
      <Notice resource={submissions} />
      {submissions.data && !own && <div className="notice">No acknowledged Rooted submission is recorded in the {node} scope yet. Run <code>scripts/test_frame_transaction.py --submit --record</code>.</div>}
      {own && <>
        <Notice resource={tx} />
        <div className="fact-grid">
          <div><span>Transaction</span><strong><code title={own.expected_hash}>{short(own.expected_hash)}</code></strong></div>
          <div><span>Submitted</span><strong>{age(own.submitted_at)} · {own.submission_status.replaceAll("_", " ")}</strong></div>
          <div><span>Lifecycle</span><strong>{state ? state.status.replaceAll("_", " ") : "Not observed yet"}</strong></div>
          <div><span>Admission</span><strong>{state?.admission_confirmed ? "Confirmed" : "Not confirmed"}</strong></div>
          <div><span>Inclusion verified</span><strong>{state?.inclusion_confirmed ? <span className="success"><Check size={14} />Confirmed</span> : "Not confirmed"}</strong></div>
          <div><span>Receipt check</span><strong>{state?.receipt_check ? `identity ${state.receipt_check.identity_matched ? "matched" : "mismatched"} · canonical ${verdict(state.receipt_check.canonical).toLowerCase()}` : "No receipt check yet"}</strong></div>
        </div>
        <div className="panel-footer">
          <a className="text-button" href={explorerTx(own.expected_hash)} target="_blank" rel="noreferrer">Alt-mempool explorer</a>
          <a className="text-button" href={`/api/backend/api/v1/frames/transactions/${own.expected_hash}/evidence?${ownQuery}`} target="_blank" rel="noreferrer">Rooted raw evidence</a>
          {state && <Evidence value={state} label="Archived lifecycle" />}
        </div>
      </>}
    </Panel>
    <Panel title="Admission conformance" subtitle="Boundary cases sent to the devnet: what each source expects vs what the node did"
      action={run && <Badge tone={run.cases.some(divergent) ? "amber" : "green"}>{run.cases.filter(divergent).length} divergent of {run.cases.length}</Badge>}>
      <Notice resource={results} />
      {invalid && <div className="notice error" role="alert">{invalid}</div>}
      {run && <>
        <p className="footnote">Run {run.run_id} · {run.network} (chain {run.chain_id}) · genesis <code title={run.genesis}>{short(run.genesis)}</code> · sidecar {run.sidecar_version} · sender <code title={run.sender}>{short(run.sender)}</code> · {run.started_at} → {run.finished_at || "in progress"}. Expectations were written before submitting and are not edited after observation.</p>
        <div className="table-scroll"><table><thead><tr><th>Case</th>{sources.map(s => <th key={s}>{run.sources[s] ? <a href={run.sources[s]} target="_blank" rel="noreferrer">{labels[s]}</a> : labels[s]}</th>)}<th>Observed</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>
          {run.cases.map(c => <tr key={c.id} className={divergent(c) ? "conformance-divergent" : ""}>
            <td><strong>{c.id}</strong><span className="subtext">{c.description}</span></td>
            {sources.map(s => { const m = matches(c, s); return <td key={s} title={c.expected_basis[s] || undefined}>
              <Badge tone={tone(c.expected[s])}>{c.expected[s]}</Badge>{m == null ? null : m ? <Check size={13} aria-label="matches observed" /> : <X size={13} aria-label="differs from observed" />}
            </td>; })}
            <td><Badge tone={tone(c.observed)}>{c.observed}</Badge>{c.observed_rule && <span className="subtext">rule: {c.observed_rule}</span>}{c.admission?.failed_checks[0]?.detail && <span className="subtext" title={c.admission.failed_checks.map(f => `${f.rule}: ${f.detail}`).join("\n")}>{c.admission.failed_checks[0].detail}</span>}</td>
            <td>{divergent(c) ? <Badge tone="amber">divergence</Badge> : <Badge tone="green">consistent</Badge>}</td>
            <td>{c.tx_hash ? <><a className="text-button" href={explorerTx(c.tx_hash)} target="_blank" rel="noreferrer">Explorer</a><br /></> : null}
              {c.archive_status && <><Badge tone="blue">archive: {c.archive_status.replaceAll("_", " ")}</Badge><br /></>}
              <Evidence value={c} label="Case record" /></td>
          </tr>)}
        </tbody></table></div>
        <p className="footnote">A divergence means the sources disagree with each other or with the node. Unknown observations are not counted either way. Hover an expected verdict for the quoted rule.</p>
      </>}
    </Panel>
  </>;
}
