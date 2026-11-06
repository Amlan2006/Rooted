"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  Bell,
  Boxes,
  Check,
  CircleHelp,
  Command,
  Eye,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Waves,
  X,
} from "lucide-react";
import { useLive, useResource } from "@/lib/hooks";
import {
  age,
  ms,
  short,
  verdict,
  type Slot,
  type Builder,
  type Alert,
  type Frame,
  type FrameNode,
  type Incident,
  type Collector,
  type Run,
} from "@/lib/data";
import {
  Badge,
  Coverage,
  Evidence,
  Freshness,
  Notice,
  Panel,
  Stat,
} from "./ui";
import Dependencies from "./dependencies";
import GuidedInvestigation from "./guided-investigation";
import WorkloadComparison from "./workload-comparison";
import ProviderComparison from "./provider-comparison";
import ExecutionProfiler from "./execution-profiler";
import { investigationURL, selectionForRun } from "@/lib/guided-investigation";
import AnalysisForm from "./analysis-form";
import RpcInspector from "./rpc-inspector";
import CREReports from "./cre-reports";
import Xray from "./xray";
import FrameConformance from "./frame-conformance";
import { observationScope } from "@/lib/observation-scope";
type View =
  | "xray"
  | "overview"
  | "investigate"
  | "compare"
  | "providers"
  | "profiler"
  | "payloadwatch"
  | "builders"
  | "frames"
  | "bal"
  | "incidents"
  | "privacy";
const navigation = [
  { id: "xray", name: "Glamsterdam X-ray", icon: ScanLine },
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "investigate", name: "Investigate", icon: Search },
  { id: "payloadwatch", name: "PayloadWatch", icon: Waves },
  { id: "builders", name: "Builders", icon: Boxes },
  { id: "frames", name: "Frame mempool", icon: ArrowDownUp },
  { id: "bal", name: "BAL analyzer", icon: GitBranch },
  { id: "compare", name: "Compare workloads", icon: ArrowDownUp },
  { id: "providers", name: "RPC providers", icon: Globe2 },
  { id: "profiler", name: "Execution profiler", icon: Activity },
  { id: "incidents", name: "Incidents", icon: Bell },
  { id: "privacy", name: "Private RPC", icon: ShieldCheck },
] as const;
const titles: Record<View, [string, string]> = {
  xray: ["Glamsterdam X-ray", "Parallelism ceilings per Sepolia block: receipt gas, execution gas, validator with BAL, builder without."],
  profiler: ["Execution profiler", "Measure native replay processing with explicit timing boundaries."],
  providers: ["RPC provider checks", "Compare immutable evidence and API availability across providers."],
  compare: ["Workload comparison", "Compare shared-state patterns across controlled experiments."],
  investigate: ["Guided investigation", "Follow a transaction through delivery, shared state, and policy evidence."],
  overview: ["Network overview", "A clear view of the block pipeline."],
  payloadwatch: ["PayloadWatch", "Follow the commitment-to-payload lifecycle."],
  builders: [
    "Builder observations",
    "Delivery evidence, with its denominator in view.",
  ],
  frames: ["Frame mempool", "From admission to verified inclusion."],
  bal: ["BAL analyzer", "Find the state your transactions share."],
  incidents: ["Incidents", "Investigate the evidence behind each signal."],
  privacy: ["Private RPC", "Inspect execution state through Anon-RPC."],
};
const tone = (status: string) =>
  ["healthy", "included", "ok", "confirmed", "connected"].includes(status)
    ? "green"
    : ["failed", "rejected", "reverted", "missing"].includes(status)
      ? "red"
      : ["warning", "late", "reorged"].includes(status)
        ? "amber"
        : "neutral";
const percent = (n: number | null) =>
  n == null ? "Unknown" : (n * 100).toFixed(1) + "%";
export default function Dashboard() {
  const [view, setView] = useState<View>("xray");
  const [guideScope, setGuideScope] = useState<{ network: string; chain_id: string } | null>(null);
  const [demo, setDemo] = useState(false);
  const [analysisMode, setAnalysisMode] = useState("live");
  const [requestedRun, setRequestedRun] = useState<Run | null>(null);
  const [node, setNode] = useState("gateway");
  const [query, setQuery] = useState("");
  const [picked, setSelected] = useState<Slot | null>(null);
  const [pickedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const [tick, setTick] = useState(0);
  const [, clock] = useState(0);
  const [builderWindow, setWindow] = useState("1h");
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("view");
    if (navigation.some((n) => n.id === id)) setView(id as View);
    const timer = setInterval(() => clock((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (picked)
      document
        .getElementById("slot-detail")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [picked?.slot, picked?.block_root]);
  useEffect(() => {
    if (pickedFrame)
      document
        .getElementById("frame-detail")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pickedFrame?.tx_hash]);
  const navigate = (next: View) => {
    setView(next);
    setQuery("");
    setSelected(null);
    setSelectedFrame(null);
    history.replaceState(null, "", "?view=" + next);
    window.scrollTo(0, 0);
  };
  const collector = useResource<{ network: string; source: string; data: Collector }>(
    "/api/v1/collector?network=sepolia",
    tick,
  );
  const liveSource = collector.data?.network === "sepolia"
    ? collector.data.source : undefined;
  const activeSource = demo ? "phase3-demo" : liveSource;
  const watchScope = observationScope(demo ? "synthetic" : "live", activeSource);
  const frameScope = `network=frame-devnet&mode=live&node=${node}`;
  const update = useCallback(() => setTick((n) => n + 1), []);
  const stream = useLive(watchScope, update);
  const slots = useResource<{ data: Slot[] }>(
    watchScope ? `/api/v1/slots?${watchScope}&limit=50` : null,
    tick,
  );
  const builders = useResource<{ data: Builder[]; denominator: string }>(
    watchScope ? `/api/v1/builders?${watchScope}&window=${builderWindow}` : null,
    tick,
  );
  const alerts = useResource<{ data: Alert[] }>(
    watchScope ? `/api/v1/alerts?${watchScope}` : null,
    tick,
  );
  const frames = useResource<{ data: Frame[] }>(
    `/api/v1/frames/transactions?${frameScope}&limit=50`,
  );
  const frameNode = useResource<{ data: FrameNode }>(
    `/api/v1/frames/node?${frameScope}`,
  );
  const frameIncidents = useResource<{ data: Incident[] }>(
    `/api/v1/frames/incidents?${frameScope}`,
  );
  const analysis = useResource<{ data: Run[] }>(
    view === "bal"
      ? `/api/v1/analysis/runs?network=${analysisMode === "fork" ? "sepolia-fork" : "sepolia"}&mode=${analysisMode}&limit=1`
      : null,
    0,
    30000,
  );
  const selected = picked && watchScope && picked.source_id === activeSource &&
    picked.mode === (demo ? "synthetic" : "live")
    ? slots.data?.data.find(
        (s) => s.slot === picked.slot && s.block_root === picked.block_root,
      ) || picked
    : null;
  const selectedFrame = pickedFrame
    ? frames.data?.data.find((f) => f.tx_hash === pickedFrame.tx_hash) ||
      pickedFrame
    : null;
  const timeline = useResource<{
    data: {
      sequence: number;
      event: {
        block_root: string;
        kind: string;
        observed_at: string;
        timed: boolean;
        payload_hash?: string;
      };
    }[];
  }>(
    selected
      ? `/api/v1/payloadwatch/slots/${selected.slot}/timeline?${watchScope}&limit=200`
      : null,
    tick,
  );
  const data = slots.data?.data || [],
    frameData = frames.data?.data || [],
    stats = builders.data?.data || [];
  const filtered = data.filter((s) =>
    `${s.slot} ${s.block_root} ${s.builder_index} ${s.payload_hash}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const observations = stats.reduce((sum, b) => sum + b.observations, 0),
    timed = stats.reduce((sum, b) => sum + b.timed_samples, 0),
    active = (alerts.data?.data || []).filter((a) => a.active);
  const latest = collector.data?.data;
  const sourceStale =
    !!collector.error ||
    !latest?.last_success ||
    Date.now() - Date.parse(latest.last_success) > 60000;
  const run = analysisMode === "live" && requestedRun ? requestedRun : analysis.data?.data[0];
  function scopeControl() {
    return (
      <div className="scope-control">
        <span className="scope-label">Payload evidence</span>
        <select
          aria-label="Payload evidence mode"
          value={demo ? "synthetic" : "live"}
          onChange={(e) => {
            setDemo(e.target.value === "synthetic");
            setSelected(null);
          }}
        >
          <option value="live">Sepolia · live · {liveSource || "resolving source…"}</option>
          <option value="synthetic">Synthetic lifecycle demo</option>
        </select>
      </div>
    );
  }
  function slotTable(limit = 50) {
    return (
      <>
        <Notice resource={slots} empty={!data.length} />
        {data.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Slot / block root</th>
                  <th>Builder</th>
                  <th>Payload delivery</th>
                  <th>Reveal latency</th>
                  <th>Evidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((s) => (
                  <tr key={s.slot + s.block_root}>
                    <td>
                      <button
                        className="slot-link"
                        onClick={() => {
                          setSelected(s);
                          if (view === "overview") {
                            setView("payloadwatch");
                            history.replaceState(
                              null,
                              "",
                              "?view=payloadwatch",
                            );
                          }
                        }}
                      >
                        {s.slot}
                      </button>
                      <code className="subtext" title={s.block_root}>
                        {short(s.block_root)}
                      </code>
                    </td>
                    <td className="mono">
                      {s.builder_index === "18446744073709551615"
                        ? "Self-build"
                        : s.builder_index || "Unknown"}
                    </td>
                    <td>
                      <Badge tone={tone(s.delivery)}>{s.delivery}</Badge>
                    </td>
                    <td className="mono">{ms(s.reveal_latency_ms)}</td>
                    <td>
                      <span className="evidence-count">
                        {s.event_count} events
                      </span>
                      <Badge tone={tone(s.status)}>{s.status}</Badge>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={"Inspect slot " + s.slot}
                        onClick={() => {
                          setSelected(s);
                          setView("payloadwatch");
                        }}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="notice">
                No matching observations in the current 50-slot response.
              </div>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" aria-label="Rooted home" href="/">
          <div className="brand-mark">
            <Waves size={24} />
          </div>
          <span>
            Rooted
            <small>ETHEREUM OBSERVATORY</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.name}
              aria-current={view === item.id ? "page" : undefined}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.name}</span>
              {item.id === "incidents" && active.length > 0 && (
                <small>{active.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-network">
            <i />
            <span>
              Sepolia testnet<small>Execution + consensus</small>
            </span>
          </div>
          <a
            href="?view=privacy"
            onClick={(e) => {
              e.preventDefault();
              navigate("privacy");
            }}
          >
            <CircleHelp size={16} />
            Traffic & privacy
            <ArrowRight size={14} />
          </a>
          <span className="version">ROOTED / GLAMSTERDAM X-RAY</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{navigation.find((n) => n.id === view)?.name}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={
                "live-status " + (stream === "connected" ? "" : "disconnected")
              }
            >
              <i />
              {stream === "connected"
                ? "API stream connected"
                : "API stream " + stream}
            </span>
            <span className="network-pill">
              <Globe2 size={13} />
              {view === "investigate" ? (guideScope?.network === "sepolia-fork" ? "Sepolia fork" : guideScope ? "Sepolia" : "Investigation") : view === "frames"
                ? "Frame devnet"
                : (view === "bal" && analysisMode === "fork") || view === "compare"
                  ? "Sepolia fork"
                  : "Sepolia"}{" "}
              <span className="dot-divider" />
              {view === "investigate" ? (guideScope?.chain_id || "Scope below") : view === "frames"
                ? "1337"
                : (view === "bal" && analysisMode === "fork") || view === "compare"
                  ? "31337"
                  : "11155111"}
            </span>
            <button
              className="refresh-button"
              onClick={() => {
                update();
                frames.refresh();
                frameNode.refresh();
                frameIncidents.refresh();
                analysis.refresh();
              }}
              aria-label="Refresh observations"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                OBSERVE / UNDERSTAND / INVESTIGATE
              </span>
              <h1>
                {titles[view][0]}
                <span className="title-dot">.</span>
              </h1>
              <p>{titles[view][1]}</p>
            </div>
            {["overview", "payloadwatch", "builders", "incidents"].includes(
              view,
            ) ? (
              scopeControl()
            ) : view === "frames" ? (
              <div className="scope-control">
                <span className="scope-label">
                  Independent network · chain 1337
                </span>
                <select
                  aria-label="Frame node"
                  value={node}
                  onChange={(e) => {
                    setNode(e.target.value);
                    setSelectedFrame(null);
                  }}
                >
                  <option value="gateway">Frame devnet · gateway</option>
                  <option value="miner">Frame devnet · miner</option>
                </select>
              </div>
            ) : view === "bal" ? (
              <div className="scope-control">
                <span className="scope-label">Analysis evidence</span>
                <select
                  aria-label="Analysis evidence mode"
                  value={analysisMode}
                  onChange={(e) => setAnalysisMode(e.target.value)}
                >
                  <option value="live">Sepolia · native BAL</option>
                  <option value="fork">
                    Local fork · controlled trace demo
                  </option>
                </select>
              </div>
            ) : (
              <Badge tone="blue">{view === "investigate" ? "SCOPED INVESTIGATION" : "READ-ONLY INVESTIGATION"}</Badge>
            )}
          </div>
          {!demo && ["overview", "payloadwatch", "builders", "incidents"].includes(view) && !watchScope && (
            collector.error ? <Notice resource={collector} /> :
              <div className="notice" role="status">Resolving the backend's live observation source…</div>
          )}
          {demo &&
            ["overview", "payloadwatch", "builders", "incidents"].includes(
              view,
            ) && (
              <div className="notice warning">
                <Eye size={17} />
                Synthetic PayloadWatch lifecycle evidence · source phase3-demo.
                Frame-devnet data remains independently live.
              </div>
            )}
          {["overview", "payloadwatch", "builders", "incidents"].includes(
            view,
          ) && (
            <div className="coverage-banner">
              <div className="banner-icon">
                <Radio size={18} />
              </div>
              <div>
                <strong>Know what the data can tell you.</strong>
                <p>
                  {latest?.stream_status === "connected"
                    ? "Beacon stream connected. Timing is reported only where comparable source observations exist."
                    : "Live Beacon event streaming is unavailable. Polling retrieves identifiers and payload presence; original reveal timing remains unknown."}
                </p>
              </div>
              <Badge tone={sourceStale ? "amber" : "green"}>
                {sourceStale
                  ? "Collector stale"
                  : "Polling " + (latest?.poll_status || "unknown")}
              </Badge>
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="stats">
                <Stat
                  label="Latest collected slot"
                  value={data[0]?.slot || latest?.last_slot || "Unknown"}
                  detail={"Collector success: " + age(latest?.last_success)}
                />
                <Stat
                  label="Observed commitments"
                  value={builders.data ? observations : "Unknown"}
                  detail={`${demo ? "Synthetic" : "Live"} · builder window ${builderWindow}`}
                />
                <Stat
                  label="Comparable timing samples"
                  value={builders.data ? timed : "Unknown"}
                  detail={
                    timed
                      ? "Only evidence with comparable timestamps"
                      : "Reveal latency remains unknown"
                  }
                />
                <Stat
                  label="Active payload incidents"
                  value={alerts.data ? active.length : "Unknown"}
                  detail="Within the latest 50 returned alerts"
                  tone={active.length ? "amber" : ""}
                />
              </div>
              <div className="overview-grid">
                <Panel
                  title="Payload activity"
                  subtitle="Recent slots · real persisted observations"
                  action={
                    <Badge tone={demo ? "amber" : "blue"}>
                      {demo ? "SYNTHETIC" : "LIVE"}
                    </Badge>
                  }
                >
                  <Notice resource={slots} />
                  <div className="slot-strip">
                    {data
                      .slice(0, 40)
                      .reverse()
                      .map((s) => (
                        <button
                          key={s.slot + s.block_root}
                          className={"slot-cell " + s.status}
                          title={`Slot ${s.slot}: ${s.delivery}, ${ms(s.reveal_latency_ms)}`}
                          aria-label={`Open slot ${s.slot}: ${s.status}`}
                          onClick={() => {
                            setSelected(s);
                            setView("payloadwatch");
                          }}
                        />
                      ))}
                  </div>
                  <div className="strip-scale">
                    <span>{data[39]?.slot || data.at(-1)?.slot || "—"}</span>
                    <span>50-slot response · oldest → newest</span>
                    <span>{data[0]?.slot || "—"}</span>
                  </div>
                  <div className="activity-legend">
                    <span>
                      <i className="legend healthy" />
                      Healthy
                    </span>
                    <span>
                      <i className="legend warning" />
                      Warning
                    </span>
                    <span>
                      <i className="legend failed" />
                      Failed
                    </span>
                    <span>
                      <i className="legend pending" />
                      Partial / pending
                    </span>
                  </div>
                  <Coverage
                    items={Array.from(
                      new Set(data.flatMap((s) => s.coverage)),
                    ).slice(0, 8)}
                  />
                </Panel>
                <Panel
                  title="Collector connections"
                  subtitle="Source health is separate from chain health"
                >
                  <Notice resource={collector} />
                  <div className="connection-row">
                    <span>
                      <Waves size={17} />
                      Beacon polling
                    </span>
                    <Badge
                      tone={
                        sourceStale
                          ? "amber"
                          : tone(latest?.poll_status || "unknown")
                      }
                    >
                      {sourceStale ? "Stale" : latest?.poll_status || "Unknown"}
                    </Badge>
                  </div>
                  <div className="connection-row">
                    <span>
                      <Radio size={17} />
                      Beacon event source
                    </span>
                    <Badge tone="amber">
                      {latest?.stream_status || "Unknown"}
                    </Badge>
                  </div>
                  <div className="connection-row">
                    <span>
                      <ArrowDownUp size={17} />
                      Frame {node}
                    </span>
                    <Badge
                      tone={tone(
                        frameNode.data?.data.stream_status || "unknown",
                      )}
                    >
                      {frameNode.data?.data.stream_status || "Unknown"}
                    </Badge>
                  </div>
                  <div className="connection-row">
                    <span>
                      <ShieldCheck size={17} />
                      Browser RPC
                    </span>
                    <button
                      className="text-button"
                      onClick={() => navigate("privacy")}
                    >
                      Inspect with Nox
                      <ArrowRight size={13} />
                    </button>
                  </div>
                  <p className="footnote">
                    Backend API stream: {stream}. This is distinct from the
                    upstream Beacon stream.
                  </p>
                </Panel>
              </div>
              <Panel
                title="Recent payload observations"
                subtitle="Select a slot to inspect its lifecycle"
                action={
                  <button
                    className="text-button"
                    onClick={() => navigate("payloadwatch")}
                  >
                    View all
                    <ArrowRight size={14} />
                  </button>
                }
              >
                {slotTable(7)}
                <div className="panel-footer">
                  <Freshness at={slots.at} error={slots.error} />
                  <span>
                    Network: Sepolia · Source: {activeSource || "resolving source…"}
                  </span>
                </div>
              </Panel>
            </>
          )}
          {view === "payloadwatch" && (
            <>
              <Panel
                title="Payload lifecycle"
                subtitle="Commitment, presence, and validation coverage"
                action={
                  <div className="search-box">
                    <Search size={15} />
                    <input
                      aria-label="Search slots"
                      placeholder="Slot, root, or builder…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                }
              >
                {slotTable()}
                <div className="panel-footer">
                  <Freshness at={slots.at} error={slots.error} />
                  <span>
                    {demo ? "Synthetic replay" : "Live observations"} · no
                    inferred arrival times
                  </span>
                </div>
              </Panel>
              {selected && (
                <Panel
                  id="slot-detail"
                  title={"Slot " + selected.slot}
                  subtitle={selected.block_root}
                  action={
                    <button
                      onClick={() => setSelected(null)}
                      aria-label="Close slot details"
                    >
                      <X size={17} />
                    </button>
                  }
                >
                  <div className="fact-grid">
                    {[
                      ["Delivery", selected.delivery],
                      ["Reveal latency", ms(selected.reveal_latency_ms)],
                      ["PTC timely", verdict(selected.ptc_timely)],
                      ["Blob availability", verdict(selected.blob_available)],
                      ["Execution validity", verdict(selected.execution_valid)],
                      ["Canonical", verdict(selected.canonical)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                  <Notice resource={timeline} />
                  <div className="timeline">
                    {timeline.data?.data
                      .filter((e) => e.event.block_root === selected.block_root)
                      .map((entry) => (
                        <div key={entry.sequence}>
                          <i />
                          <div>
                            <strong>
                              {entry.event.kind.replaceAll("_", " ")}
                            </strong>
                            <p>
                              {new Date(
                                entry.event.observed_at,
                              ).toLocaleString()}{" "}
                              <Badge>
                                {entry.event.timed
                                  ? "Comparable timing"
                                  : "Snapshot / untimed"}
                              </Badge>
                            </p>
                          </div>
                          <span className="mono">#{entry.sequence}</span>
                        </div>
                      ))}
                  </div>
                  <Coverage items={selected.coverage} />
                  <div className="panel-footer">
                    <span>
                      {selected.source_id} · {selected.mode} ·{" "}
                      {age(selected.updated_at)}
                    </span>
                    <Evidence value={selected} label="Slot evidence" />
                  </div>
                </Panel>
              )}
            </>
          )}
          {view === "builders" && (
            <Panel
              title="Delivery by builder"
              subtitle="Canonical selected commitments first observed in the selected window"
              action={
                <select
                  aria-label="Builder observation window"
                  value={builderWindow}
                  onChange={(e) => setWindow(e.target.value)}
                >
                  <option value="1h">Last hour</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="168h">Last 7 days</option>
                </select>
              }
            >
              <Notice resource={builders} empty={!stats.length} />
              {stats.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Builder index</th>
                        <th>Observations</th>
                        <th>Payload retrieved</th>
                        <th>Fully healthy</th>
                        <th>Unknown</th>
                        <th>P50 reveal</th>
                        <th>Timing samples</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((b) => (
                        <tr key={b.builder_index}>
                          <td className="mono">
                            {b.self_build ? "Self-build" : b.builder_index}
                          </td>
                          <td>{b.observations}</td>
                          <td>{percent(b.reveal_ratio)}</td>
                          <td>{percent(b.healthy_ratio)}</td>
                          <td>{b.unknown}</td>
                          <td className="mono">{ms(b.p50_reveal_ms)}</td>
                          <td>{b.timed_samples}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="panel-footer">
                <Freshness at={builders.at} error={builders.error} />
                <span>
                  Coverage ratios describe observations, not builder reputation.
                </span>
              </div>
              <Coverage
                items={[
                  builders.data?.denominator ||
                    "Window excludes observations outside its first-observed interval",
                  "Null percentiles mean no comparable timing samples",
                  "Self-build is kept distinct from external builders",
                ]}
              />
            </Panel>
          )}
          {view === "frames" && (
            <>
              <div className="stats">
                <Stat
                  label="Network"
                  value="Frame devnet"
                  detail={`Chain ${frameNode.data?.data.chain_id || "unknown"} · ${node}`}
                />
                <Stat
                  label="Observed lifecycles"
                  value={frames.data ? frameData.length : "Unknown"}
                  detail="Latest 50 states in selected node"
                />
                <Stat
                  label="Verified inclusions"
                  value={
                    frames.data
                      ? frameData.filter((f) => f.inclusion_confirmed).length
                      : "Unknown"
                  }
                  detail="Receipt + canonical block match"
                />
                <Stat
                  label="Admission rejected"
                  value={
                    frames.data
                      ? frameData.filter((f) => f.status === "rejected").length
                      : "Unknown"
                  }
                  detail="Failed admission rules in this scope"
                />
              </div>
              <Panel
                title="Frame transaction lifecycle"
                subtitle="Admission reports and receipt verification are separate facts"
                action={<Badge tone="blue">LIVE · CHAIN 1337</Badge>}
              >
                <Notice resource={frames} empty={!frameData.length} />
                <Notice resource={frameNode} />
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Transaction</th>
                        <th>Lifecycle</th>
                        <th>Admitted</th>
                        <th>Inclusion verified</th>
                        <th>Admission → inclusion</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {frameData.map((f, i) => (
                        <tr key={f.tx_hash + i}>
                          <td>
                            <button
                              className="mono text-button"
                              title={f.tx_hash}
                              onClick={() => setSelectedFrame(f)}
                            >
                              {short(f.tx_hash)}
                            </button>
                            <span className="subtext">{age(f.updated_at)}</span>
                          </td>
                          <td>
                            <Badge tone={tone(f.status)}>
                              {f.status.replaceAll("_", " ")}
                            </Badge>
                          </td>
                          <td>
                            {f.admission_confirmed
                              ? "Confirmed"
                              : "Not confirmed"}
                          </td>
                          <td>
                            {f.inclusion_confirmed ? (
                              <span className="success">
                                <Check size={14} />
                                Confirmed
                              </span>
                            ) : (
                              "Not confirmed"
                            )}
                          </td>
                          <td className="mono">
                            {ms(f.admission_to_inclusion_ms)}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              onClick={() => setSelectedFrame(f)}
                              aria-label={"Inspect frame " + f.tx_hash}
                            >
                              <ArrowRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="panel-footer">
                  <Freshness at={frames.at} error={frames.error} />
                  <Evidence
                    value={frameNode.data?.data}
                    label="Node identity"
                  />
                </div>
              </Panel>
              {selectedFrame && (
                <Panel
                  id="frame-detail"
                  title="Admission & inclusion evidence"
                  subtitle={selectedFrame.tx_hash}
                  action={
                    <button
                      aria-label="Close frame details"
                      onClick={() => setSelectedFrame(null)}
                    >
                      <X size={17} />
                    </button>
                  }
                >
                  <div className="fact-grid">
                    <div>
                      <span>Admission</span>
                      <strong>
                        {selectedFrame.admission_confirmed
                          ? "Confirmed"
                          : "Not confirmed"}
                      </strong>
                    </div>
                    <div>
                      <span>Canonical receipt</span>
                      <strong>
                        {verdict(selectedFrame.receipt_check?.canonical)}
                      </strong>
                    </div>
                    <div>
                      <span>Execution success</span>
                      <strong>
                        {verdict(selectedFrame.execution_success)}
                      </strong>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Admission rule</th>
                          <th>Verdict</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedFrame.admission?.checks?.map((check, i) => (
                          <tr key={i}>
                            <td>{check.rule}</td>
                            <td>
                              <Badge
                                tone={
                                  check.verdict === "pass"
                                    ? "green"
                                    : check.verdict === "fail"
                                      ? "red"
                                      : "neutral"
                                }
                              >
                                {check.verdict}
                              </Badge>
                            </td>
                            <td>{check.detail || "No detail"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Coverage items={selectedFrame.coverage} />
                  <div className="panel-footer">
                    <Evidence
                      value={selectedFrame.events}
                      label="Lifecycle events"
                    />
                    <Evidence
                      value={selectedFrame}
                      label="Full frame evidence"
                    />
                  </div>
                </Panel>
              )}
            </>
          )}
          {view === "frames" && <FrameConformance scope={frameScope} />}
          {view === "xray" && <Xray />}
          {view === "investigate" && <GuidedInvestigation onScope={setGuideScope} />}
          {view === "compare" && <WorkloadComparison />}
          {view === "providers" && <ProviderComparison />}
          {view === "profiler" && <ExecutionProfiler />}
          {view === "bal" && (
            <>
              {analysisMode === "live" && <AnalysisForm onComplete={(result) => { setRequestedRun(result); analysis.refresh(); }} />}
              {analysisMode === "live" && requestedRun && <div className="notice">
                Showing your requested analysis; automatic refresh will not replace it.
                <button onClick={() => { setRequestedRun(null); analysis.refresh(); }}>Show latest saved report</button>
              </div>}
              {!requestedRun || analysisMode !== "live" ? <Notice resource={analysis} empty={!analysis.data?.data.length} /> : null}
              {run && <><div className="notice"><a href={investigationURL(selectionForRun(run))}>Investigate this report across modules →</a></div><Dependencies key={run.id} run={run} /></>}
              <Freshness at={analysis.at} error={analysis.error} />
            </>
          )}
          {view === "incidents" && (
            <>
              <Panel
                title="Payload incidents"
                subtitle="Active and resolved signals in the selected payload scope"
                action={
                  <Badge tone={demo ? "amber" : "blue"}>
                    {demo ? "SYNTHETIC" : "LIVE"}
                  </Badge>
                }
              >
                <Notice resource={alerts} empty={!alerts.data?.data.length} />
                <div className="incident-list">
                  {alerts.data?.data.map((a, i) => (
                    <div key={i}>
                      <div
                        className={
                          "incident-icon " + (a.active ? "warning" : "resolved")
                        }
                      >
                        <Bell size={18} />
                      </div>
                      <div>
                        <h3>{a.code.replaceAll("_", " ")}</h3>
                        <p>
                          Slot {a.slot} · {short(a.block_root)} ·{" "}
                          {age(a.first_detected_at)}
                        </p>
                      </div>
                      <Badge tone={a.active ? "amber" : "green"}>
                        {a.active ? "Active" : "Resolved"}
                      </Badge>
                      <Evidence value={a} />
                    </div>
                  ))}
                </div>
                <div className="panel-footer">
                  <Freshness at={alerts.at} error={alerts.error} />
                  <span>Detection is not a protocol verdict.</span>
                </div>
              </Panel>
              <Panel
                title="Frame-devnet incidents"
                subtitle={`Independent chain 1337 · ${node} · live`}
              >
                <Notice
                  resource={frameIncidents}
                  empty={!frameIncidents.data?.data.length}
                />
                <div className="incident-list">
                  {frameIncidents.data?.data.map((a, i) => (
                    <div key={i}>
                      <div className="incident-icon warning">
                        <Activity size={18} />
                      </div>
                      <div>
                        <h3>{a.code.replaceAll("_", " ")}</h3>
                        <p>
                          {short(a.tx_hash)} · {age(a.observed_at)}
                        </p>
                      </div>
                      <Evidence value={a} />
                    </div>
                  ))}
                </div>
              </Panel>
              <CREReports key={liveSource || "pending"} liveSource={liveSource} />
            </>
          )}
          {view === "privacy" && <RpcInspector />}
          <footer className="page-footer">
            <span>
              <Waves size={14} />
              Rooted<span>Ethereum, with evidence.</span>
            </span>
            <span>Sepolia / frame-devnet / explicitly labeled fork data</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
