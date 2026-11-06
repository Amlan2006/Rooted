"use client";
import { Fragment, useState } from "react";
import ConflictExplanation from "./conflict-explanation";
import ContentionBreakdown from "./contention-breakdown";
import InvestigationDownload from "./investigation-download";
import { Badge, Coverage, Evidence, Panel, Stat } from "./ui";
import type { Graph, Run } from "@/lib/data";
import { short, age, verdict } from "@/lib/data";
export default function Dependencies({ run, initialFocus = null, linkedSource }: { run: Run; initialFocus?: number | null; linkedSource?: string | null }) {
  const [projection, setProjection] = useState(true);
  const [focus, setFocus] = useState<number | null>(initialFocus);
  const [explained, setExplained] = useState<string | null>(null);
  const graph: Graph = projection ? run.storage_projection : run.graph;
  const symbol = (address: string) =>
    address.toLowerCase() === "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"
      ? "USDC"
      : address.toLowerCase() === "0xfff9976782d46cc05630d1f6ebab18b2324d6b14"
        ? "WETH"
        : short(address);
  const pools = new Set(run.uniswap_pools.map((p) => p.address));
  const linked = graph.edges
    .filter((e) => pools.has(e.location.address))
    .flatMap((e) => [e.from, e.to]);
  const indices = Array.from(
    new Set([...(focus == null ? [] : [focus]), ...linked, ...run.transaction_access.map((a) => a.index)]),
  )
    .slice(0, 12)
    .sort((a, b) => a - b);
  const points = new Map(
    indices.map((index, i) => [
      index,
      {
        x: 65 + i * (860 / Math.max(1, indices.length - 1)),
        y: 80 + (i % 2) * 92,
      },
    ]),
  );
  const visible = graph.edges.filter(
    (e) =>
      points.has(e.from) &&
      points.has(e.to) &&
      (focus == null || e.from === focus || e.to === focus),
  );
  const unique = Array.from(
    new Map(visible.map((e) => [`${e.from}:${e.to}:${e.kind}`, e])).values(),
  );
  const selected = run.transaction_access.find((a) => a.index === focus);
  return (
    <>
      <div className="analysis-identity">
        <div>
          <Badge tone={run.mode === "fork" ? "amber" : "blue"}>
            {run.mode === "fork"
              ? "Local fork · trace demo"
              : "Live · native BAL"}
          </Badge>
          <h2>Block {parseInt(run.block.number, 16).toLocaleString()}</h2>
          <code title={run.block.hash}>{run.block.hash}</code>
        </div>
        <div className="identity-note">
          {run.network} · chain {run.chain_id}
          <br />
          Analyzed {age(run.created_at)}
          <br />
          Canonical at fetch: {verdict(run.canonical_at_fetch)}
        </div>
      </div>
      <InvestigationDownload key={`${run.id}:${run.created_at}:${projection}:${focus}:${linkedSource || "default-source"}`} run={run} projection={projection} focus={focus} linkedSource={linkedSource} />
      <div className="stats">
        <Stat
          label="Committed changes"
          tone="word"
          value={run.native_bal ? "Native BAL" : "Trace diff"}
          detail={
            run.native_bal
              ? `${run.native_bal.accounts} accounts · commitment ${verdict(run.native_bal.commitment_verified).toLowerCase()}`
              : "Conventional fork · native BAL unavailable"
          }
        />
        <Stat
          label="Observed depth"
          value={graph.observed_dependency_depth}
          detail={
            projection
              ? "Storage projection · unit-cost nodes"
              : "Known state graph · unit-cost nodes"
          }
        />
        <Stat
          label="Largest observed layer"
          value={graph.observed_max_layer_width}
          detail="Partial graph; not an execution schedule"
        />
        <Stat
          label="Speedup"
          value="Unknown"
          detail="No full model or execution benchmark"
        />
      </div>
      <Panel
        id="state-dependencies"
        title="State dependency map"
        subtitle="Transaction order → exact state-location overlap"
        action={
          <div className="segmented">
            <button
              className={projection ? "active" : ""}
              onClick={() => {
                setProjection(true);
                setFocus(null);
              }}
            >
              Storage projection
            </button>
            <button
              className={!projection ? "active" : ""}
              onClick={() => {
                setProjection(false);
                setFocus(null);
              }}
            >
              All known state
            </button>
          </div>
        }
      >
        <div className="graph-legend">
          <span>
            <i className="raw" />
            RAW {graph.observed_conflict_counts.RAW || 0}
          </span>
          <span>
            <i className="war" />
            WAR {graph.observed_conflict_counts.WAR || 0}
          </span>
          <span>
            <i className="waw" />
            WAW {graph.observed_conflict_counts.WAW || 0}
          </span>
          <span className="muted">Read / read is not a conflict</span>
        </div>
        <div className="graph-scroll">
          <svg
            viewBox="0 0 1000 260"
            className="dependency-map"
            aria-label="Observed transaction dependency graph"
          >
            <defs>
              <pattern
                id="grid"
                width="22"
                height="22"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r=".8" fill="var(--line-strong)" />
              </pattern>
            </defs>
            <rect width="1000" height="260" fill="url(#grid)" />
            {unique.slice(0, 120).map((e) => {
              const a = points.get(e.from)!,
                b = points.get(e.to)!;
              return (
                <path
                  key={`${e.from}-${e.to}-${e.kind}`}
                  d={`M ${a.x + 21} ${a.y} C ${a.x + 55} ${a.y - 40}, ${b.x - 55} ${b.y - 40}, ${b.x - 21} ${b.y}`}
                  fill="none"
                  stroke={
                    e.kind === "RAW"
                      ? "var(--fg-2)"
                      : e.kind === "WAR"
                        ? "var(--warn)"
                        : "var(--fg-3)"
                  }
                  strokeWidth="1.6"
                />
              );
            })}
            {indices.map((index) => {
              const p = points.get(index)!;
              return (
                <g
                  key={index}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect transaction ${index}`}
                  onClick={() => setFocus(focus === index ? null : index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFocus(focus === index ? null : index);
                    }
                  }}
                  className="graph-node"
                >
                  <rect
                    x={p.x - 23}
                    y={p.y - 23}
                    rx="10"
                    width="46"
                    height="46"
                    fill={focus === index ? "var(--acc-soft)" : "var(--surface-2)"}
                    stroke={focus === index ? "var(--acc)" : "var(--line-strong)"}
                  />
                  <text
                    x={p.x}
                    y={p.y + 5}
                    textAnchor="middle"
                    fill={focus === index ? "var(--acc)" : "var(--fg)"}
                    fontSize="14"
                  >
                    {index}
                  </text>
                  <text
                    x={p.x}
                    y={p.y + 43}
                    textAnchor="middle"
                    fill="var(--fg-3)"
                    fontSize="10"
                  >
                    TX {index}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p className="footnote">
          Showing up to 12 transactions, prioritizing observed pool overlaps.
          Lines group location-level edges by transaction pair and type.{" "}
          {projection
            ? "Balance, nonce, code, and fee-recipient effects are excluded from this projection."
            : "Known balance, nonce, code, and fee-recipient effects are included."}
        </p>
        {selected && (
          <div className="selected-transaction">
            <strong>Transaction {selected.index}</strong>
            <code>{short(selected.hash)}</code>
            <span>
              {selected.reads.length} known reads · {selected.writes.length}{" "}
              committed writes
            </span>
            <Evidence value={selected} label="Transaction access evidence" />
          </div>
        )}
        <Coverage
          items={[
            ...graph.coverage,
            ...run.coverage,
            `full_dependency_coverage: ${graph.full_dependency_coverage}`,
            `storage_read_coverage_complete: ${graph.storage_read_coverage_complete}`,
          ]}
        />
      </Panel>
      <ContentionBreakdown run={run} graph={graph} projection={projection} focus={focus} />
      <div className="two-columns" id="uniswap-results">
        <Panel
          title="Uniswap v3 pools"
          subtitle="Identity checked through factory.getPool"
        >
          {run.uniswap_pools.length ? (
            run.uniswap_pools.map((pool) => (
              <div className="pool-row" key={pool.address}>
                <div className="token-icons">
                  <span>U</span>
                  <span>Ξ</span>
                </div>
                <div>
                  <h3>
                    {symbol(pool.token0)} / {symbol(pool.token1)}{" "}
                    <small>fee {pool.fee}</small>
                  </h3>
                  <code title={pool.address}>{short(pool.address)}</code>
                  <div className="small muted">
                    Token addresses: {short(pool.token0)} / {short(pool.token1)}
                  </div>
                </div>
                <Badge tone={pool.verified ? "green" : "amber"}>
                  {pool.verified ? "Verified" : "Unverified"}
                </Badge>
              </div>
            ))
          ) : (
            <div className="notice">No verified pool observations.</div>
          )}
          <p className="footnote">
            Known token symbols identify the tested Sepolia deployment; unknown
            tokens retain addresses. No decimal-adjusted amounts are inferred.
          </p>
        </Panel>
        <Panel
          title="Swap outcomes"
          subtitle="Retained events and rolled-back internal calls are distinct"
        >
          <div className="mini-stats">
            <div>
              <strong>{run.uniswap_swaps.length}</strong>
              <span>committed events</span>
            </div>
            <div>
              <strong>{run.uniswap_swap_calls.length}</strong>
              <span>observed swap calls</span>
            </div>
            <div>
              <strong>
                {run.uniswap_swap_calls.filter((c) => !c.committed).length}
              </strong>
              <span>uncommitted calls</span>
            </div>
          </div>
          {run.uniswap_swap_calls.map((call, i) => (
            <div className="outcome-row" key={i}>
              <code title={call.transaction_hash}>
                {short(call.transaction_hash)}
              </code>
              <Badge tone={call.committed ? "green" : "amber"}>
                {call.committed
                  ? "Committed"
                  : call.transaction_reverted
                    ? "Transaction reverted"
                    : "Call rolled back"}
              </Badge>
            </div>
          ))}
        </Panel>
      </div>
      <Panel
        id="conflict-evidence"
        title="Conflict evidence"
        subtitle="Exact location-level conflicts; first 60 matching rows"
        action={<Evidence value={run.sources} label="Sources" />}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Transaction pair</th>
                <th>Dependency</th>
                <th>Account</th>
                <th>Field / storage key</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {graph.edges
                .filter(
                  (e) => focus == null || e.from === focus || e.to === focus,
                )
                .slice(0, 60)
                .map((edge, i) => {
                  const key = `${projection}:${focus}:${edge.from}:${edge.to}:${edge.kind}:${edge.location.address}:${edge.location.field}:${edge.location.key || ""}`;
                  return <Fragment key={key}><tr>
                    <td className="mono">
                      {edge.from} → {edge.to}
                    </td>
                    <td>
                      <Badge tone={edge.kind === "RAW" ? "blue" : "neutral"}>
                        {edge.kind}
                      </Badge>
                    </td>
                    <td>
                      <code title={edge.location.address}>
                        {short(edge.location.address)}
                      </code>
                    </td>
                    <td>
                      <code title={edge.location.key}>
                        {edge.location.field}
                        {edge.location.key
                          ? " · " + short(edge.location.key)
                          : ""}
                      </code>
                    </td>
                    <td><button className="text-button" aria-expanded={explained === key} aria-controls={`conflict-explanation-${i}`} onClick={() => setExplained(explained === key ? null : key)}>{explained === key ? "Hide explanation" : `Explain ${edge.kind}`}</button></td>
                  </tr>
                  {explained === key && <tr id={`conflict-explanation-${i}`}><td colSpan={5}><ConflictExplanation run={run} edge={edge} graph={graph} projection={projection} /></td></tr>}
                  </Fragment>;
                })}
            </tbody>
          </table>
        </div>
        <div className="panel-footer">
          <span>Incomplete evidence does not establish independence.</span>
          <Evidence value={run} label="Full analysis report" />
        </div>
      </Panel>
    </>
  );
}
