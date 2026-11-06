"use client";
import { useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { useResource } from "@/lib/hooks";
import { observationScope } from "@/lib/observation-scope";
import { age, ms, short } from "@/lib/data";
import {
  Badge,
  Coverage,
  Evidence,
  Freshness,
  Notice,
  Panel,
  Stat,
} from "./ui";
type Report = {
  id: string;
  network: string;
  mode: string;
  source: string;
  execution_mode: string;
  workflow_id: string;
  summary_id: string;
  evaluated_at: string;
  received_at: string;
  authentication: string;
  decision: { outcome: string; codes: string[] };
  policy: {
    id: string;
    policy_network: string;
    policy_chain_id: string;
    contract: string;
    block_number: string;
    block_hash: string;
    values: {
      max_summary_age_seconds: number;
      max_observation_age_seconds: number;
      max_reveal_latency_ms: number;
      max_missing_payloads: number;
      min_observations: number;
      min_timed_samples: number;
    };
  };
};
type Snapshot = {
  id: string;
  network: string;
  mode: string;
  source: string;
  monitored_chain_id: string;
  generated_at: string;
  requested_at: string;
  latest_observation_at: string | null;
  observations: number;
  timed_samples: number;
  missing_payloads: number;
  unknown_deliveries: number;
  max_reveal_latency_ms: number | null;
  coverage: string[];
  evidence: unknown[];
  max_latency_evidence: unknown;
};
const outcome = (value: string) =>
  value === "healthy"
    ? "Within policy"
    : value === "breach"
      ? "Policy breach"
      : "Unavailable";
const color = (value: string) =>
  value === "healthy" ? "green" : value === "breach" ? "red" : "amber";
export default function CREReports({ liveSource }: { liveSource?: string }) {
  const [selection, setSelection] = useState("live");
  const [selected, setSelected] = useState<Report | null>(null);
  const mode = selection === "live" ? "live" : "synthetic";
  const source = selection === "live" ? liveSource : selection;
  const scope = observationScope(mode, source);
  const reports = useResource<{ data: Report[] }>(
    scope ? `/api/v1/cre/reports?${scope}&limit=20` : null,
  );
  const summary = useResource<{ data: Snapshot }>(
    selected && scope
      ? `/api/v1/incidents/summaries/${selected.summary_id}?${scope}`
      : null,
  );
  const data = reports.data?.data || [],
    snapshot = summary.data?.data;
  return (
    <div id="cre-reports">
      <Panel
        title="Chainlink CRE policy checks"
        subtitle="Authenticated reports bound to an immutable summary and registered onchain policy"
        action={
          <div className="scope-control">
            <label className="scope-label" htmlFor="cre-source">
              CRE observation source
            </label>
            <select
              id="cre-source"
              value={selection}
              onChange={(e) => {
                setSelection(e.target.value);
                setSelected(null);
              }}
            >
              <option value="live">Live Sepolia · {liveSource || "resolving source…"}</option>
              <option value="phase7-healthy">
                Synthetic · healthy / scope mismatch
              </option>
              <option value="phase7-breach">Synthetic · latency breach</option>
              <option value="phase7-missing">
                Synthetic · missing payload
              </option>
              <option value="phase7-stale">Synthetic · stale data</option>
              <option value="phase7-incomplete">
                Synthetic · incomplete timing
              </option>
              <option value="phase7-empty">Synthetic · no observations</option>
            </select>
          </div>
        }
      >
        <div className="cre-context">
          <ShieldCheck size={18} />
          <div>
            <strong>CRE CLI simulation · observed policy checks</strong>
            <p>
              Policy network is shown separately from monitored Sepolia.
              Receiver authentication uses a credential and decision
              recomputation; these reports are not DON-signed or a verdict on
              overall chain health.
            </p>
          </div>
          <Badge tone={mode === "live" ? "blue" : "amber"}>
            {mode === "live" ? "LIVE OBSERVATIONS" : "SYNTHETIC OBSERVATIONS"}
          </Badge>
        </div>
        <Notice resource={reports} />
        {reports.data && !reports.loading && !reports.error && !data.length && (
          <div className="notice">
            No CRE reports for this source yet. Run its workflow simulation to
            receive a policy check.
          </div>
        )}
        {data.length > 0 && (
          <>
            <div className="mini-stats">
              <div>
                <strong>
                  {data.filter((r) => r.decision.outcome === "breach").length}
                </strong>
                <span>policy breaches</span>
              </div>
              <div>
                <strong>
                  {
                    data.filter((r) => r.decision.outcome === "unavailable")
                      .length
                  }
                </strong>
                <span>unavailable checks</span>
              </div>
              <div>
                <strong>
                  {data.filter((r) => r.decision.outcome === "healthy").length}
                </strong>
                <span>within policy</span>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Monitored scope</th>
                    <th>Policy chain / contract</th>
                    <th>Evaluated</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <Badge tone={color(report.decision.outcome)}>
                          {outcome(report.decision.outcome)}
                        </Badge>
                        <span className="subtext">
                          {report.decision.codes
                            .join(", ")
                            .replaceAll("_", " ") || "No threshold exceeded"}
                        </span>
                      </td>
                      <td>
                        Sepolia · {report.mode}
                        <span className="subtext">
                          {report.source} · {report.execution_mode}
                        </span>
                      </td>
                      <td>
                        {report.policy.policy_network}
                        <span className="subtext">
                          Chain {report.policy.policy_chain_id} ·{" "}
                          <code title={report.policy.contract}>
                            {short(report.policy.contract)}
                          </code>
                        </span>
                      </td>
                      <td title={report.evaluated_at}>
                        {age(report.evaluated_at)}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelected(report)}
                        >
                          Inspect summary
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="panel-footer">
          <Freshness at={reports.at} error={reports.error} />
          <span>Counts cover the latest 20 reports in this source.</span>
        </div>
      </Panel>
      {selected && (
        <Panel
          title="CRE decision evidence"
          subtitle={selected.id}
          action={
            <Evidence value={selected} label="Report & policy evidence" />
          }
        >
          <div className="fact-grid">
            <div>
              <span>Decision</span>
              <strong>{outcome(selected.decision.outcome)}</strong>
            </div>
            <div>
              <span>Execution</span>
              <strong>{selected.execution_mode}</strong>
            </div>
            <div>
              <span>Monitored network</span>
              <strong>
                {selected.network} · {selected.mode}
              </strong>
            </div>
            <div>
              <span>Policy network</span>
              <strong>{selected.policy.policy_network}</strong>
            </div>
            <div>
              <span>Policy read block</span>
              <strong>
                {parseInt(selected.policy.block_number, 16).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Policy latency threshold</span>
              <strong>
                {ms(selected.policy.values.max_reveal_latency_ms)}
              </strong>
            </div>
          </div>
          <Notice resource={summary} />
          {snapshot && (
            <>
              <div className="fact-grid">
                <div>
                  <span>Observations</span>
                  <strong>{snapshot.observations}</strong>
                </div>
                <div>
                  <span>Comparable timing samples</span>
                  <strong>{snapshot.timed_samples}</strong>
                </div>
                <div>
                  <span>Maximum reveal latency</span>
                  <strong>{ms(snapshot.max_reveal_latency_ms)}</strong>
                </div>
                <div>
                  <span>Confirmed missing deliveries</span>
                  <strong>{snapshot.missing_payloads}</strong>
                </div>
                <div>
                  <span>Snapshot generated</span>
                  <strong>{age(snapshot.generated_at)}</strong>
                </div>
                <div>
                  <span>Latest observation</span>
                  <strong>
                    {snapshot.latest_observation_at
                      ? age(snapshot.latest_observation_at)
                      : "Unknown"}
                  </strong>
                </div>
              </div>
              <Coverage
                items={[...snapshot.coverage, ...selected.decision.codes]}
              />
              <div className="panel-footer">
                <Evidence value={snapshot} label="Immutable summary snapshot" />
                <Evidence
                  value={snapshot.max_latency_evidence}
                  label="Maximum latency source"
                />
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
