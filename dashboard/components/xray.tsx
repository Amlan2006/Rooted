"use client";
import { useEffect, useMemo, useState } from "react";
import { Cpu } from "lucide-react";
import { useResource } from "@/lib/hooks";
import { age, ms, short, verdict } from "@/lib/data";
import { milliseconds } from "@/lib/profiler";
import { formatPrice, formatX, laneRows, parseBriefs, parseReport, parseSummary, paymentTerms, speedupSeries, type Brief, type PaymentTerms, type Report, type Summary } from "@/lib/xray";
import { Badge, Coverage, Evidence, Notice, Panel, Stat } from "./ui";
import uniswapExample from "@/lib/uniswap-contention-example.json";

const repo = "https://github.com/Amlan2006/Rooted/blob/main";
const percent = (n: number | null | undefined) => (n == null ? "Unknown" : (n * 100).toFixed(0) + "%");
type Loaded = { report?: Report; status: number | null; error?: string; stored?: boolean; paidURL?: string };

export default function Xray() {
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState<Loaded>({ status: null });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [computeError, setComputeError] = useState(""), [readOnly, setReadOnly] = useState(false);
  const blocks = useResource<{ data: unknown }>("/api/v1/xray/blocks?network=sepolia&limit=30", 0, 15000);
  const summary = useResource<{ data: unknown }>("/api/v1/xray/summary?network=sepolia", 0, 60000);
  useEffect(() => {
    const block = new URLSearchParams(location.search).get("block")?.toLowerCase();
    if (block && /^0x[0-9a-f]{64}$/.test(block)) setSelected(block);
  }, []);
  const [briefs, briefError] = useMemo((): [Brief[], string] => {
    try { return [blocks.data ? parseBriefs(blocks.data.data) : [], ""]; } catch (e) { return [[], e instanceof Error ? e.message : "Invalid block list"]; }
  }, [blocks.data]);
  const stats = useMemo(() => { try { return summary.data ? parseSummary(summary.data.data) : null; } catch { return null; } }, [summary.data]);
  const offline = !!blocks.error && !blocks.data;
  const target = selected ?? briefs[0]?.block_hash ?? null;
  // Pin the first block shown; newer blocks only appear as chips, so the numbers never change mid-sentence.
  useEffect(() => { if (!selected && briefs[0]) setSelected(briefs[0].block_hash); }, [briefs, selected]);
  useEffect(() => {
    let stopped = false;
    const signal = AbortSignal.timeout(25000);
    const set = (next: Loaded) => { if (!stopped) setLoaded(next); };
    async function load() {
      if (offline) {
        const response = await fetch("/examples/xray-report.json", { cache: "no-store", signal });
        if (!response.ok) return set({ status: null, error: "Backend offline, no stored report." });
        const body = await response.json();
        return set({ report: parseReport(body.data ?? body), status: 200, stored: true });
      }
      if (!target) return set({ status: null });
      const response = await fetch(`/api/backend/api/v1/xray/blocks/${target}?network=sepolia`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (response.status === 402) return set({ status: 402, paidURL: body.error?.paid_url });
      if (!response.ok) return set({ status: response.status, error: body.error?.message || `Backend HTTP ${response.status}` });
      set({ report: parseReport(body.data), status: 200 });
    }
    load().catch(e => set({ status: null, error: e instanceof Error ? e.message : "X-ray request failed" }));
    return () => { stopped = true; };
  }, [target, offline, reload]);
  const select = (hash: string) => {
    setSelected(hash);
    history.replaceState(null, "", `?view=xray&block=${hash}`);
  };
  async function compute() {
    setComputeError("");
    const hash = (input.trim() || target || "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash)) return setComputeError("Enter a 32-byte Sepolia execution block hash.");
    setBusy(true);
    try {
      const response = await fetch("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block_hash: hash }), signal: AbortSignal.timeout(95000) });
      const body = await response.json();
      if (response.status === 403 && body.error?.code === "hosted_read_only") setReadOnly(true);
      if (!response.ok) throw Error(body.error?.message || `X-ray unavailable (HTTP ${response.status})`);
      setLoaded({ report: parseReport(body.data), status: 201 });
      select(hash);
      blocks.refresh();
    } catch (e) { setComputeError(e instanceof Error ? e.message : "X-ray failed"); } finally { setBusy(false); }
  }
  const report = loaded.report;
  const brief = briefs.find(b => b.block_hash === target);
  const canCompute = loaded.status !== 402 && !readOnly && !offline;
  return <>
    <div className="coverage-banner">
      <div className="banner-icon"><Cpu size={18} /></div>
      <div>
        <strong>With an EIP-7928 block access list, validators can execute every transaction in parallel.</strong>
        <p>The validator ceiling is Amdahl on measured replay time. The conflict DAG is the builder / no-BAL view, not the validator limit: a static scheduler orders every RAW, WAR and WAW conflict, while a multi-version executor renames WAR away. Every ceiling here is an upper bound for its model.</p>
      </div>
      <Badge tone="blue">UPPER BOUNDS</Badge>
    </div>
    {offline ? (report
      ? <div className="notice warning"><Badge tone="amber">STORED</Badge>Backend offline. Showing the committed example report computed {report.computed_at} ({age(report.computed_at)}).</div>
      : loaded.error && <div className="notice error" role="alert">{loaded.error}</div>)
      : <Notice resource={blocks} empty={!briefs.length && !selected} />}
    {briefError && <div className="notice error" role="alert">{briefError}</div>}
    {loaded.status === 402 && <div className="notice warning"><Badge tone="amber">PAID VIA X402</Badge>Hosted mode: the full report for this block is sold to agents via x402{loaded.paidURL ? <> at <code>{loaded.paidURL}</code></> : null}. The brief below stays free.</div>}
    {loaded.status === 404 && <div className="notice">No stored X-ray for {short(target)} yet.{canCompute ? " Compute it below." : ""}</div>}
    {loaded.error && !offline && loaded.status !== 404 && <div className="notice error" role="alert">{loaded.error}<button onClick={() => setReload(n => n + 1)}>Retry</button></div>}
    {!offline && <RecentBlocks briefs={briefs} target={target} stats={stats} onSelect={select} />}
    {report ? <ReportView key={report.block.hash} report={report} stored={!!loaded.stored} />
      : loaded.status === 402 && brief && <BriefHero brief={brief} />}
    {canCompute && <Panel title="Compute an X-ray" subtitle="Capture, replay 7× on native Geth v1.17.10 ApplyMessage, and store the report">
      <form className="analysis-form" onSubmit={e => { e.preventDefault(); void compute(); }} aria-busy={busy}>
        <div className="analysis-inputs transaction-only">
          <label>Execution block hash<input value={input} onChange={e => setInput(e.target.value)} placeholder={target || "0x… a recent Sepolia block with at most 512 transactions"} disabled={busy} /></label>
          <button disabled={busy}>{busy ? "Capturing and replaying…" : "Compute X-ray"}</button>
        </div>
        <p>The node keeps state for only about 128 recent blocks. One native replay runs at a time; a busy replay answers 429. A stored profile for the same block is reused without re-measuring.</p>
        {computeError && <div className="notice error" role="alert">{computeError}</div>}
      </form>
    </Panel>}
    <HostedAPI hash={report?.block.hash ?? target} />
  </>;
}

function Hero({ cells }: { cells: [string, string, number | null, string][] }) {
  return <div className="stats xray-hero">{cells.map(([label, meaning, value, detail]) =>
    <div className="stat" key={label}>
      <span>{label} · {meaning} <Badge>upper bound</Badge></span>
      <strong>{formatX(value)}</strong>
      <small>{detail}</small>
    </div>)}</div>;
}
const cap = (i: number | null) => (i == null ? "capping tx unknown" : `capping tx #${i}`);

function BriefHero({ brief: b }: { brief: Brief }) {
  return <Hero cells={[
    ["Receipt gas", "execution + EIP-8037 state gas", b.gas_weighted, `${cap(b.gas_capping_tx_index)} · weight: receipt gasUsed`],
    ["Execution gas", "the EIP-8037 dimension that prices compute", b.execution_gas_weighted ?? null, "weight: execution gas"],
    ["Validator with BAL", "Amdahl on measured time", b.validator_bal_time, `${cap(b.validator_capping_tx_index)} · weight: ns`],
    ["Builder / no BAL", "static conflict-DAG critical path", b.builder_dag_time, `critical path ${b.builder_critical_path_length ?? "unknown"} txs · multi-version ${formatX(b.builder_multiversion_time)} · weight: ns`],
  ]} />;
}

function ReportView({ report: r, stored }: { report: Report; stored: boolean }) {
  const c = r.ceilings;
  const timed = c.validator_bal_time.value != null;
  const [weight, setWeight] = useState<"ns" | "exec" | "gas">(timed ? "ns" : "gas");
  const [picked, setPicked] = useState<number | null>(null);
  const rows = useMemo(() => laneRows(r), [r]);
  const tx = picked == null ? null : r.transactions[picked];
  const gasMax = Math.max(r.gas.header_gas_used, r.gas.receipts_gas_sum, 1);
  return <>
    <div className="analysis-identity">
      <div>
        <Badge tone={stored ? "amber" : "blue"}>{stored ? "STORED" : r.source.toUpperCase()}</Badge>{" "}
        <Badge tone={r.bal.commitment_verified ? "green" : "amber"}>{r.bal.commitment_verified ? "BAL commitment verified" : "BAL commitment unverified"}</Badge>
        <h2>Sepolia block {r.block.number.toLocaleString()}</h2>
        <code title={r.block.hash}>{r.block.hash}</code>
      </div>
      <div className="identity-note">
        {r.block.transaction_count} transactions · slot {r.block.slot ?? "unknown"}<br />
        Computed {r.computed_at} ({age(r.computed_at)})<br />
        <Evidence value={r} label="Full X-ray report" />
      </div>
    </div>
    <Hero cells={[
      ["Receipt gas", "execution + EIP-8037 state gas", c.gas_weighted.value, `${cap(c.gas_weighted.capping_tx_index)} · Σ receipt gas / max`],
      ["Execution gas", "the EIP-8037 dimension that prices compute", c.execution_gas_weighted?.value ?? null, c.execution_gas_weighted ? `${cap(c.execution_gas_weighted.capping_tx_index)} · Σ execution gas / max` : "not in this report (older replay runner)"],
      ["Validator with BAL", "Amdahl on measured time", c.validator_bal_time.value, `${cap(c.validator_bal_time.capping_tx_index)} · weight: ns · Σt / max t`],
      ["Builder / no BAL", "static conflict-DAG critical path (orders RAW, WAR, WAW)", c.builder_dag_time.value, `${cap(c.builder_dag_time.capping_tx_index)} · path of ${c.builder_dag_time.critical_path?.length ?? "unknown"} txs · multi-version executor (WAR renamed away): ${c.builder_multiversion_time ? `${formatX(c.builder_multiversion_time.value)}, path of ${c.builder_multiversion_time.critical_path?.length ?? "unknown"}` : "not in this report"} · weight: ns`],
    ]} />
    <Panel title="Gas accounting" subtitle="Header gasUsed vs the sum of receipt gasUsed (EIP-8037 two-dimensional gas)">
      <div className="contention-categories xray-gas">
        <div><span>Header gasUsed</span><strong>{r.gas.header_gas_used.toLocaleString()}</strong><meter min={0} max={gasMax} value={r.gas.header_gas_used} aria-label="Header gasUsed" /></div>
        <div><span>Receipt gasUsed sum</span><strong>{r.gas.receipts_gas_sum.toLocaleString()}</strong><meter min={0} max={gasMax} value={r.gas.receipts_gas_sum} aria-label="Receipt gas sum" /></div>
      </div>
      <p className="footnote">{r.gas.differs ? "These differ: under EIP-8037 the header counts max(Σ execution gas, Σ state gas), while receipts count execution + state gas." : "Header and receipt sum agree for this block."} The receipt-gas ceiling therefore mixes in state gas (contract creations are heavy in it); the execution-gas ceiling uses only the dimension that prices compute. Gas limit {r.block.gas_limit.toLocaleString()}, applied to each dimension separately.</p>
    </Panel>
    <Panel title="Transaction lanes" subtitle={`One bar per transaction · width ∝ ${weight === "ns" ? "median native ApplyMessage time (7 samples)" : weight === "exec" ? "EIP-8037 execution gas" : "receipt gasUsed (execution + state gas)"}`}
      action={<div className="segmented">{(["ns", "exec", "gas"] as const).map(w => <button key={w} className={weight === w ? "active" : ""} aria-pressed={weight === w} onClick={() => setWeight(w)}>{{ ns: "Time", exec: "Exec gas", gas: "Receipt gas" }[w]}</button>)}</div>}>
      {!timed && weight === "ns" && <div className="notice">No replay metrics for this block, so time lanes are unknown. Switch to gas.</div>}
      {weight === "exec" && rows[0]?.exec == null && <div className="notice">This report predates per-transaction execution gas. Switch to receipt gas.</div>}
      <div className="activity-legend"><span><i className="legend lane-cap" />Validator capping tx</span><span><i className="legend lane-critical" />Builder critical path</span><span><i className="legend lane-gas" />Gas capping tx (outlined)</span></div>
      <div className="lane-list">{rows.map(row => {
        const width = weight === "ns" ? row.widthNs : weight === "exec" ? row.widthExec : row.widthGas;
        return <button key={row.index} className={"lane-row" + (row.validatorCap ? " cap" : row.onCriticalPath ? " critical" : "") + (row.gasCap ? " gas-cap" : "") + (picked === row.index ? " picked" : "")}
          aria-pressed={picked === row.index} onClick={() => setPicked(row.index)}
          aria-label={`Transaction ${row.index}: ${milliseconds(row.ns)}, ${row.gas.toLocaleString()} gas${row.validatorCap ? ", validator capping" : ""}${row.onCriticalPath ? ", on builder critical path" : ""}`}>
          <span className="mono">#{row.index}</span>
          <span className="lane-track"><i style={{ width: width == null ? 0 : `${Math.max(width * 100, 0.4)}%` }} /></span>
          <small className="mono">{weight === "ns" ? milliseconds(row.ns) : weight === "exec" ? row.exec?.toLocaleString() ?? "Unknown" : row.gas.toLocaleString()}</small>
        </button>;
      })}</div>
      {tx && <div className="fact-grid">
        <div><span>Transaction #{tx.index}</span><strong><code title={tx.hash}>{short(tx.hash)}</code></strong></div>
        <div><span>From → to</span><strong><code>{short(tx.from)}</code> → {tx.is_create ? "contract creation" : <code>{short(tx.to)}</code>}</strong></div>
        <div><span>Status · receipt gas</span><strong>{tx.status === 1 ? "success" : "reverted"} · {tx.gas_used.toLocaleString()}</strong></div>
        <div><span>Execution · state gas</span><strong>{tx.execution_gas == null ? "Unknown" : `${tx.execution_gas.toLocaleString()} · ${tx.state_gas?.toLocaleString() ?? "?"}`}</strong></div>
        <div><span>ApplyMessage median</span><strong>{milliseconds(tx.apply_ns_median)}</strong></div>
        <div><span>Modelled reads / writes</span><strong>{tx.reads} / {tx.writes}</strong></div>
        <div><span>Builder critical path</span><strong>{rows[tx.index].onCriticalPath ? "On the path" : "Not on the path"}</strong></div>
        <div><span>Depends on (builder view)</span><strong>{tx.depends_on.length ? tx.depends_on.map(i => <button key={i} className="text-button" onClick={() => setPicked(i)}>#{i}</button>) : "Nothing: independent"}</strong></div>
        <div><span>Depended on by</span><strong>{r.transactions.filter(t => t.depends_on.includes(tx.index)).map(t => <button key={t.index} className="text-button" onClick={() => setPicked(t.index)}>#{t.index}</button>)}</strong></div>
      </div>}
      <p className="footnote">{r.independent_transactions} of {r.block.transaction_count} transactions depend on no earlier transaction. Edges: {r.edges.RAW} RAW · {r.edges.WAR} WAR · {r.edges.WAW} WAW across {r.edges.dependent_pairs} dependent pairs{r.edges.truncated ? " (edge limit reached)" : ""}.</p>
    </Panel>
    <Panel title="Speedup vs cores" subtitle="Scheduled upper bounds: LPT for validators with BAL, bottom-level list scheduling for builders. Both axes log₂.">
      <CoresChart report={r} />
    </Panel>
    <Panel title="Hot state locations" subtitle="Top 10 by conflict edges in the builder / no-BAL view, plus up to 10 more Uniswap-labelled locations">
      {r.hot_locations.length ? <div className="table-scroll"><table><thead><tr><th>Location</th><th>Label</th><th>Writers / readers</th><th>Edges</th><th>Critical path</th></tr></thead><tbody>
        {r.hot_locations.map(h => <tr key={h.address + h.field + h.key}>
          <td><code title={h.address}>{short(h.address)}</code><br /><code title={h.key}>{h.field}{h.key ? ` · ${short(h.key)}` : ""}</code></td>
          <td>{h.label ? <><Badge tone="blue">{h.label.protocol.replace("_", " ")} · {h.label.name.replaceAll("_", " ")}</Badge> <Badge tone={h.label.verified ? "green" : "amber"}>{h.label.verified ? "verified" : "unverified"}</Badge><br /><code title={h.label.pool}>{short(h.label.pool)}</code></> : "Unlabelled"}</td>
          <td>{h.writers} / {h.readers}</td><td>{h.edges}</td>
          <td>{h.on_critical_path ? <Badge tone="amber">on path</Badge> : "No"}</td>
        </tr>)}
      </tbody></table></div> : <div className="notice">No conflict edges in this block.</div>}
      <p className="footnote">Uniswap: {r.uniswap.v3_swap_transactions} v3 swap transactions · {r.uniswap.v4_swap_transactions} v4 swap transactions · {r.uniswap.labeled_edges} labelled edges. Token balance labels assume a storage layout and stay unverified.</p>
      {!r.hot_locations.some(h => h.label) && <UniswapExample />}
    </Panel>
    <Panel title="ePBS delivery" subtitle={r.epbs ? `Slot ${r.epbs.slot} · source ${r.epbs.source}` : "Payload envelope and PayloadWatch state"}>
      {r.epbs ? <div className="fact-grid">
        <div><span>Builder</span><strong>{r.epbs.self_build || r.epbs.builder_index === "18446744073709551615" ? "Self-build" : r.epbs.builder_index}</strong></div>
        <div><span>Beacon block root</span><strong><code title={r.epbs.beacon_block_root}>{short(r.epbs.beacon_block_root)}</code></strong></div>
        <div><span>Delivery · status</span><strong>{r.epbs.delivery ?? "Unknown"} · {r.epbs.status ?? "Unknown"}</strong></div>
        <div><span>Reveal latency</span><strong>{ms(r.epbs.reveal_latency_ms)}</strong></div>
        <div><span>PTC payload yes / no</span><strong>{r.epbs.ptc_payload_yes ?? "Unknown"} / {r.epbs.ptc_payload_no ?? "Unknown"}</strong></div>
        <div><span>PTC timely · canonical</span><strong>{verdict(r.epbs.ptc_timely)} · {verdict(r.epbs.canonical)}</strong></div>
      </div> : <div className="notice">ePBS state unavailable for this block.</div>}
    </Panel>
    <Panel title="Measurement scope" subtitle="What these upper bounds do and do not include">
      <p className="footnote">{r.replay ? `Replay ${r.replay.runner} · Geth library ${r.replay.geth_library} · ${r.replay.cpu_model} · ${r.replay.logical_cpus} logical CPUs · ${r.replay.samples} ${r.replay.timing === "uninstrumented_control" ? "uninstrumented" : "instrumented (state-call timers on, which inflates state-heavy txs unevenly)"} samples · block median ${milliseconds(r.replay.median_apply_ns)}. Time ceilings vary by up to about 25% between replays of the same block, so read them to two significant figures.` : "No replay metrics: time ceilings are unknown."} BAL {r.bal.accounts} accounts from {r.bal.source}. {r.excluded_addresses.length} addresses excluded (fee recipient, system contracts, precompiles).</p>
      <Coverage items={r.coverage} />
    </Panel>
  </>;
}

// Shown when no hot location in the current block is Uniswap-labelled (most Sepolia blocks): a real labelled case.
function UniswapExample() {
  const e = uniswapExample;
  return <details className="coverage"><summary>Labelled Uniswap contention example <span>Sepolia block {e.block_number.toLocaleString()} · {e.labeled_edges} labelled BAL edges</span></summary>
    <p className="footnote">Txs {e.locations[0].transactions.join(", ")} swap the same factory-verified v3 pool, so a builder must order them. BAL writes only (the block is outside the node&apos;s state window); commitment {e.commitment_verified ? "verified" : "unverified"}. Re-derived by <code>TestLiveBALContention</code>.</p>
    <div className="table-scroll"><table><thead><tr><th>Location</th><th>Label</th><th>Writer txs</th><th>Edges</th></tr></thead><tbody>
      {e.locations.map(h => <tr key={h.address + h.key}>
        <td><code title={h.address}>{short(h.address)}</code><br /><code title={h.key}>{h.field} · {short(h.key)}</code></td>
        <td><Badge tone="blue">{h.label.protocol.replace("_", " ")} · {h.label.name.replaceAll("_", " ")}</Badge> <Badge tone={h.label.verified ? "green" : "amber"}>{h.label.verified ? "verified" : "unverified"}</Badge><br /><code title={h.label.pool}>{short(h.label.pool)}</code></td>
        <td>{h.transactions.map(i => `#${i}`).join(" → ")}</td><td>{h.edges} {h.pairs[0]?.[2]}</td>
      </tr>)}
    </tbody></table></div>
  </details>;
}

const palette = { validator: "#008aa3", builder: "#c26d22", reference: "#b5bec5" };
function CoresChart({ report }: { report: Report }) {
  const series = speedupSeries(report);
  const [W, H, x0, x1, y0, y1] = [620, 270, 44, 470, 236, 14];
  const x = (k: number) => x0 + (Math.log2(k) / 4) * (x1 - x0), y = (v: number) => y0 - (Math.log2(Math.min(Math.max(v, 1), 16)) / 4) * (y0 - y1);
  const lines = (["validator", "builder"] as const).filter(s => series.every(p => p[s] != null));
  const ends = lines.map(s => ({ s, y: y(series[4][s]!) }));
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 18) { const mid = (ends[0].y + ends[1].y) / 2, up = ends[0].y <= ends[1].y ? 0 : 1; ends[up].y = mid - 9; ends[1 - up].y = mid + 9; }
  const names = { validator: "Validator with BAL", builder: "Builder / no BAL" }, tags = { validator: "Validator", builder: "Builder" };
  if (!lines.length) return <div className="notice">No replay metrics, so both schedules are unknown.</div>;
  return <>
    <div className="activity-legend">{lines.map(s => <span key={s}><i className="legend" style={{ background: palette[s] }} />{names[s]}</span>)}<span><i className="legend" style={{ background: palette.reference }} />y = k (perfect scaling)</span></div>
    <svg className="cores-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Speedup vs cores. ${lines.map(s => `${names[s]}: ${series.map(p => `${p.k} cores ${formatX(p[s])}`).join(", ")}`).join(". ")}`}>
      {[1, 2, 4, 8, 16].map(v => <g key={v}>
        <line x1={x0} x2={x1} y1={y(v)} y2={y(v)} stroke="#edf0f2" />
        <text x={x0 - 8} y={y(v) + 3} textAnchor="end" className="axis">{v}×</text>
        <text x={x(v)} y={y0 + 16} textAnchor="middle" className="axis">{v}</text>
      </g>)}
      <text x={(x0 + x1) / 2} y={H - 2} textAnchor="middle" className="axis">cores (k)</text>
      <line x1={x(1)} y1={y(1)} x2={x(16)} y2={y(16)} stroke={palette.reference} strokeWidth={1.5} strokeDasharray="4 4" />
      {/* Validator is drawn wider underneath so it stays visible where the two schedules coincide. */}
      {lines.map(s => <g key={s}>
        <polyline fill="none" stroke={palette[s]} strokeWidth={s === "validator" ? 5 : 2} points={series.map(p => `${x(p.k)},${y(p[s]!)}`).join(" ")} />
        {series.map(p => <circle key={p.k} cx={x(p.k)} cy={y(p[s]!)} r={s === "validator" ? 6.5 : 4} fill={palette[s]} stroke="#fff" strokeWidth={2}><title>{`${names[s]} · ${p.k} cores · ${formatX(p[s])}`}</title></circle>)}
      </g>)}
      {ends.map(e => <text key={e.s} x={x1 + 12} y={e.y + 4} className="label">{tags[e.s]} {formatX(series[4][e.s])}</text>)}
    </svg>
    <details className="coverage"><summary>Table view <span>{series.length} core counts</span></summary>
      <div className="table-scroll"><table><thead><tr><th>Cores</th><th>Validator with BAL</th><th>Builder / no BAL</th></tr></thead><tbody>
        {series.map(p => <tr key={p.k}><td>{p.k}</td><td>{formatX(p.validator)}</td><td>{formatX(p.builder)}</td></tr>)}
      </tbody></table></div>
    </details>
  </>;
}

function RecentBlocks({ briefs, target, stats, onSelect }: { briefs: Brief[]; target: string | null; stats: Summary | null; onSelect: (hash: string) => void }) {
  if (!briefs.length) return null;
  return <Panel title="Recent X-rays" subtitle="Latest 30 stored blocks, newest first · select one to inspect">
    <div className="xray-chips">{briefs.map(b =>
      <button key={b.block_hash} aria-pressed={b.block_hash === target} onClick={() => onSelect(b.block_hash)} title={`${b.block_hash} · ${b.transaction_count} txs · ${b.source}`}>
        <strong>#{b.block_number}</strong>
        <small>rcpt {formatX(b.gas_weighted)}</small>
        <small>exec {formatX(b.execution_gas_weighted)}</small>
        <small>BAL {formatX(b.validator_bal_time)}</small>
        <small>DAG {formatX(b.builder_dag_time)}</small>
      </button>)}</div>
    {stats && stats.blocks > 0 && <div className="stats xray-summary">
      <Stat label="Median execution-gas ceiling" value={formatX(stats.ceilings.execution_gas_weighted?.median)} detail={`Receipt gas (incl. state gas) ${formatX(stats.ceilings.gas_weighted?.median)} · ${stats.blocks} blocks · ${stats.from_block}–${stats.to_block}`} />
      <Stat label="Median validator-with-BAL ceiling" value={formatX(stats.ceilings.validator_bal_time?.median)} detail={`P10 ${formatX(stats.ceilings.validator_bal_time?.p10)} · P90 ${formatX(stats.ceilings.validator_bal_time?.p90)} · 8 cores ${formatX(stats.speedup_8.validator_median)}`} />
      <Stat label="Median builder / no-BAL ceiling" value={formatX(stats.ceilings.builder_dag_time?.median)} detail={`Static scheduler · multi-version ${formatX(stats.ceilings.builder_multiversion_time?.median)} · single-tx bound in ${percent(stats.single_tx_bound_share)} of blocks · 8 cores ${formatX(stats.speedup_8.builder_median)}`} />
      <Stat label="Execution gas picks a different bottleneck" value={percent(stats.execution_gas_misidentifies_bottleneck_share)} detail={`Time-capping tx uses less execution gas than the gas-capping tx (ties excluded) · receipt gas: ${percent(stats.gas_misidentifies_bottleneck_share)} · BAL verified in ${percent(stats.commitment_verified_share)}`} />
    </div>}
  </Panel>;
}

function HostedAPI({ hash }: { hash: string | null }) {
  const [probe, setProbe] = useState<{ status: number | null; terms: PaymentTerms[] }>({ status: null, terms: [] });
  useEffect(() => {
    if (!hash) return;
    let stopped = false;
    // Unpaid probe: an x402 route answers 402 with its terms before running the handler, so nothing is charged.
    fetch(`/api/paid/xray/${hash}`, { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then(r => { if (!stopped) setProbe({ status: r.status, terms: paymentTerms(r.headers.get("PAYMENT-REQUIRED")) }); })
      .catch(() => { if (!stopped) setProbe({ status: null, terms: [] }); });
    return () => { stopped = true; };
  }, [hash]);
  return <Panel title="Hosted API for agents" subtitle="Self-hosting is free. A hosted deployment can sell per-block reports over x402." action={<Badge tone={probe.status === 402 ? "green" : "neutral"}>{probe.status === 402 ? "PAYWALL LIVE" : "READ-ONLY"}</Badge>}>
    <div className="analysis-form">
      <p>Paid endpoint: <code>GET /api/paid/xray/{"{block_hash}"}</code> returns the stored <code>rooted-xray-v1</code> report. Settlement happens only after a response below 400, so an unknown block or a backend failure is never charged. Recent-block briefs and the summary stay free.</p>
      {probe.status === 402 && probe.terms.length ? probe.terms.map((t, i) => <p key={i}>Price: <strong>{formatPrice(t)}</strong> on <code>{t.network}</code> · pay to {t.network.startsWith("hedera:") ? <a className="text-button" href={`https://hashscan.io/${t.network.split(":")[1]}/account/${t.payTo}`} target="_blank" rel="noreferrer">{t.payTo}</a> : <code>{t.payTo}</code>}{t.maxTimeoutSeconds ? ` · ${t.maxTimeoutSeconds}s payment window` : ""}. Terms read live from this deployment&apos;s 402 response.</p>)
        : <p>{probe.status === 404 ? "The paywall is off on this deployment (the default). Full reports are free here at /api/backend/api/v1/xray/blocks/{block_hash}?network=sepolia." : probe.status == null ? "Paid endpoint status unknown." : `Paid endpoint answered HTTP ${probe.status}; price unavailable.`}</p>}
      <p>How an agent pays: (1) GET the endpoint and receive 402 with a <code>PAYMENT-REQUIRED</code> header naming network, asset, amount and pay-to. (2) Its x402 client checks its spending limits, signs a Hedera testnet transfer and retries with the payment header. No human approves it. (3) The facilitator verifies and settles, and <code>PAYMENT-RESPONSE</code> carries the transaction id to look up on HashScan.</p>
      <p><a className="text-button" href={`${repo}/integrations/x402-agent/README.md`} target="_blank" rel="noreferrer">Agent setup and spend controls</a> · <a className="text-button" href={`${repo}/docs/XRAY.md`} target="_blank" rel="noreferrer">X-ray method</a> · <a className="text-button" href="https://x402.org" target="_blank" rel="noreferrer">x402 protocol</a></p>
    </div>
  </Panel>;
}
