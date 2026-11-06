"use client";
import type { ConflictEdge, Graph, Run } from "@/lib/data";
import { explainConflict } from "@/lib/conflict-explanation";
import { Evidence } from "./ui";

export default function ConflictExplanation({ run, edge, graph, projection }: {
  run: Run; edge: ConflictEdge; graph: Graph; projection: boolean;
}) {
  const finding = explainConflict(run, edge);
  return <div className="conflict-explanation-body">
      <h3>{finding.title}</h3>
      <p>{finding.explanation}</p>
      {edge.location.field === "storage" && <p><strong>Storage meaning:</strong> {finding.semanticLabel}</p>}
      <dl>
        <dt>Earlier transaction · index {edge.from}</dt>
        <dd><code>{finding.hashes[0] || "Unknown transaction hash"}</code></dd>
        <dt>Later transaction · index {edge.to}</dt>
        <dd><code>{finding.hashes[1] || "Unknown transaction hash"}</code></dd>
        <dt>Exact account</dt><dd><code>{edge.location.address}</code></dd>
        <dt>Field / storage key</dt><dd><code>{edge.location.field}{edge.location.key ? ` · ${edge.location.key}` : ""}</code></dd>
      </dl>
      {finding.evidenceNotes.map((note, index) => <p key={index} className="conflict-proof">{finding.supported ? `Transaction ${index === 0 ? edge.from : edge.to}: ` : ""}{note}</p>)}
      <p className="muted">{run.network} · {run.mode} · {projection ? "Storage projection" : "All known state"}. {graph.truncated ? "Graph edges are truncated. " : ""}{graph.full_dependency_coverage ? "Dependency coverage marked complete by this report." : "Dependency coverage is incomplete; other conflicts may be missing."} This finding does not measure execution delay or speedup.</p>
      <Evidence label={`Supporting evidence for ${edge.from} → ${edge.to} ${edge.kind}`} value={{ ...finding.evidence, graph_scope: projection ? "storage" : "all_known_state", graph_coverage: graph.coverage, graph_truncated: graph.truncated ?? null }} />
  </div>;
}
