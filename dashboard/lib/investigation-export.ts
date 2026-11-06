import type { Graph, Run } from "./data";
import { contentionBreakdown } from "./contention";
import { explainConflict } from "./conflict-explanation";
import { asRecord, type LinkedEvidence } from "./investigation-links";
import { exportCodes, exportMethods } from "./export-codes";

type Rule = (value: unknown) => unknown;
const textEnum = (...values: string[]): Rule => value => typeof value === "string" && values.includes(value) ? value : null;
const hex: Rule = value => typeof value === "string" && /^0x[0-9a-f]*$/i.test(value) ? value.toLowerCase() : null;
const hash: Rule = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
const address: Rule = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;
const number: Rule = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const integer: Rule = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const decimal: Rule = value => typeof value === "string" && /^-?\d+$/.test(value) ? value : null;
const time: Rule = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const boolean: Rule = value => typeof value === "boolean" ? value : null;
const array = (rule: Rule): Rule => value => Array.isArray(value) ? value.map(rule) : [];
const optionalArray = (rule: Rule): Rule => value => value == null ? null : array(rule)(value);
const pick = (rules: Record<string, Rule>): Rule => value => Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, rule(asRecord(value)[key])]));
const coverage: Rule = value => Array.isArray(value) ? value.map(code => typeof code === "string" && exportCodes.has(code) ? code : "unrecognized_coverage_code_omitted") : [];
const location = { address, field: textEnum("storage", "balance", "nonce", "code"), key: hex };
const edge = pick({ from: integer, to: integer, kind: textEnum("RAW", "WAR", "WAW"), location: pick(location), basis: textEnum("attributed_read_and_committed_change_evidence") });
const graph: Rule = pick({ edges: array(edge), truncated: boolean, full_dependency_coverage: boolean, storage_read_coverage_complete: boolean, observed_dependency_depth: integer, observed_max_layer_width: integer,
  observed_conflict_counts: pick({ RAW: integer, WAR: integer, WAW: integer }), observed_layers: array(array(integer)), theoretical_speedup: number, coverage });
const payload = pick({ network: textEnum("sepolia"), mode: textEnum("live"), slot: decimal, block_root: hash, payload_hash: hash,
  builder_index: decimal, status: textEnum("pending", "observed", "reorged", "missing", "failed", "healthy", "unknown", "late", "revealed"), delivery: textEnum("unknown", "timely", "late", "missing", "pending", "failed"), canonical: boolean,
  reveal_latency_ms: number, ptc_timely: boolean, blob_available: boolean, execution_valid: boolean, first_observed_at: time, updated_at: time, coverage });
const summaryEvidence = pick({ slot: decimal, block_root: hash, payload_hash: hash, delivery: textEnum("unknown", "timely", "late", "missing", "pending", "failed"), reveal_latency_ms: number, first_observed_at: time });

// Explicit allowlists: unknown fields, raw HTTP bodies, origins, auth material,
// session IDs, source names and operator metadata never enter the bundle.
export function publicAnalysis(run: Run) {
  if (!hash(run.id) || !hash(run.block.hash) || !["sepolia", "sepolia-fork"].includes(run.network) || !["live", "fork", "captured", "replay", "synthetic"].includes(run.mode)) throw new Error("Unsupported report identity for export.");
  const project = pick({
    id: hash, network: textEnum("sepolia", "sepolia-fork"), mode: textEnum("live", "fork", "captured", "replay", "synthetic"), chain_id: decimal, created_at: time, canonical_at_fetch: boolean,
    block: pick({ hash, number: hex, slotNumber: hex, parentHash: hash, miner: address, blockAccessListHash: hash, transactions: array(pick({ hash })) }),
    native_bal: value => value == null ? null : pick({ accounts: integer, commitment_verified: boolean, computed_commitment: hash, schema: textEnum("eip-7928-json-index-value-v1", "eip-7928-rlp-index-value-v1"), block_read_only_storage: optionalArray(pick(location)), changes: optionalArray(pick({ ...location, transaction_index: integer, phase: textEnum("transaction", "pre_execution", "post_execution"), source: textEnum("native_bal"), post_value: hex })) })(value),
    graph, storage_projection: graph, coverage,
    uniswap_storage_labels: value => Object.fromEntries(Object.entries(asRecord(value)).filter(([key, label]) => /^0x[0-9a-f]{40}:storage:0x[0-9a-f]{64}$/i.test(key) && ["slot0_price_tick_and_lock", "fee_growth_global_0", "fee_growth_global_1", "protocol_fees", "active_liquidity", "mapping_or_observation_storage", "unattributed_storage_key"].includes(String(label)))),
    transaction_access: array(pick({ index: integer, hash, reads: array(pick(location)), writes: array(pick(location)), storage_reads_complete: boolean, coverage })),
    analyzed_transactions: optionalArray(pick({ transaction: pick({ hash }), call_trace_available: boolean, state_diff_available: boolean, opcode_trace_available: boolean, coverage })),
    uniswap_pools: array(pick({ address, token0: address, token1: address, fee: integer, verified: boolean })),
    uniswap_swaps: array(pick({ pool: address, transaction_hash: hash, amount0_raw: decimal, amount1_raw: decimal, tick: number, pool_verified: boolean })),
    uniswap_swap_calls: array(pick({ pool: address, transaction_hash: hash, committed: boolean, transaction_reverted: boolean, ancestor_failed: boolean, pool_verified: boolean })),
    sources: value => Array.isArray(value) ? value.map((source, index) => {
      const record = asRecord(source), method = typeof record.kind === "string" ? record.kind.split(":")[0] : "";
      return { source_ref: `analysis-source-${index + 1}`, kind: exportMethods.has(method) ? method : "unclassified_source", fetched_at: time(record.fetched_at) };
    }) : [],
  });
  return project(run) as unknown as Run;
}

export function buildInvestigation(run: Run, projection: boolean, focus: number | null, links: LinkedEvidence, exportedAt = new Date().toISOString()) {
  if (focus !== null && (!Number.isSafeInteger(focus) || focus < 0)) throw new Error("Invalid transaction selection.");
  const analysis = publicAnalysis(run);
  const selected = projection ? analysis.storage_projection : analysis.graph;
  const scope: "storage_projection" | "graph" = projection ? "storage_projection" : "graph";
  const breakdown = contentionBreakdown(analysis, selected, focus);
  const matching = selected.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => focus == null || edge.from === focus || edge.to === focus);
  const findings = matching.slice(0, 60).map(({ edge, index }, order) => {
    const finding = explainConflict(analysis, edge);
    return { id: `finding-${order + 1}`, location: edge.location, kind: edge.kind, from: edge.from, to: edge.to, title: finding.title, explanation: finding.explanation, corroborated: finding.supported,
      transaction_hashes: finding.hashes, proof_notes: finding.evidenceNotes,
      evidence_refs: [`#/analysis/${scope}/edges/${index}`, "#/analysis/transaction_access", "#/analysis/native_bal", "#/analysis/sources"] };
  });
  const linkedPayloads = links.payloads.filter(row => row.network === analysis.network && row.mode === analysis.mode && row.payload_hash === analysis.block.hash && hash(row.block_root));
  const projectedPayloads: Record<string, unknown>[] = linkedPayloads.map(row => ({ ...asRecord(payload(row)), source_ref: "payload-source-1" }));
  const linkedPolicies = links.policies.filter(({ report, summary }) => report.summary_id === summary.id && hash(report.id) && hash(summary.id) &&
    report.network === analysis.network && report.mode === analysis.mode && summary.network === analysis.network && summary.mode === analysis.mode &&
    summary.monitored_chain_id === analysis.chain_id && report.source === summary.source &&
    [...(Array.isArray(summary.evidence) ? summary.evidence : []), summary.max_latency_evidence].map(asRecord).some(entry => linkedPayloads.some(row => row.source_id === report.source && entry.block_root === row.block_root && entry.payload_hash === row.payload_hash && entry.slot === row.slot)));
  const policies = linkedPolicies.map(({ report, summary }) => ({
    relationship: "Window-level policy check containing the matched payload observation; not a transaction verdict.", source_ref: "payload-source-1",
    report: pick({ network: textEnum("sepolia"), mode: textEnum("live"), id: hash, summary_id: hash, execution_mode: textEnum("simulation", "production"), authentication: textEnum("bearer_authenticated_not_don_signature", "bearer_authenticated_recomputed_not_don_signature"), workflow_id: textEnum("rooted-incidents-v1"),
      evaluated_at: time, received_at: time, decision: pick({ outcome: textEnum("healthy", "breach", "unavailable"), codes: coverage }),
      policy: pick({ id: hash, policy_network: textEnum("sepolia", "sepolia-fork", "sepolia-policy-fork"), policy_chain_id: decimal, contract: address, block_number: hex, block_hash: hash, code_hash: hash, registered_at: time,
        values: pick({ version: integer, monitored_chain_id: decimal, scope_hash: hash, max_summary_age_seconds: integer, max_observation_age_seconds: integer, max_reveal_latency_ms: integer, max_missing_payloads: integer, min_observations: integer, min_timed_samples: integer }) }) })(report),
    summary: pick({ network: textEnum("sepolia"), mode: textEnum("live"), id: hash, schema_version: integer, monitored_chain_id: decimal, generated_at: time, requested_at: time, window_start: time, window_seconds: integer,
      observations: integer, timed_samples: integer, missing_payloads: integer, unknown_deliveries: integer, max_reveal_latency_ms: number, evidence_truncated: boolean, coverage,
      evidence: array(summaryEvidence), max_latency_evidence: value => value == null ? null : summaryEvidence(value) })(summary),
  }));
  return {
    schema: "rooted.investigation", schema_version: "1.0.0", exported_at: time(exportedAt),
    selection: { graph: scope, transaction_index: focus, denominator: breakdown.total, findings_shown: findings.length, findings_limit: 60 },
    analysis, findings,
    contention: { categories: breakdown.categories, hotspots: breakdown.hotspots, cross_pool: breakdown.crossPool },
    linked_evidence: {
      payload_status: projectedPayloads.length ? "matched" : links.payloadStatus === "matched" ? "not_found_in_search" : textEnum("not_found_in_search", "unavailable", "unsupported_scope")(links.payloadStatus),
      policy_status: policies.length ? "matched" : links.policyStatus === "matched" ? "not_found_in_search" : textEnum("not_found_in_search", "unavailable", "unsupported_scope")(links.policyStatus),
      search_bounds: pick({ payloadLimit: integer, policyLimit: integer, summaryLimit: integer, summariesChecked: integer, summaryFailures: integer })(links.search), payloads: projectedPayloads, policy_checks: policies },
    privacy: { field_allowlist: true, endpoint_origins_removed: true, operator_source_names_replaced: true, raw_responses_excluded: true, unknown_text_codes_omitted: true },
    limitations: ["This is an export of stored analysis, not a new chain observation or a signed proof.",
      "Graph dependencies are partial unless the report explicitly establishes coverage. No execution delay or speedup is measured.",
      "Native BAL commitment checks do not establish complete per-transaction read coverage.",
      "Payload/CRE lookups are bounded and optional; absent results do not prove no evidence exists. Only the current configured live source is searched.",
      "Collector receipt timing includes its network path and is not global propagation time or protocol timeliness.",
      "Policy checks are scoped to observation windows and preserve simulation labels; they are not verdicts about a transaction.",
      "Transport endpoints, operator source names, raw request/response bodies, and unknown diagnostic strings are intentionally omitted."],
  };
}
export type Investigation = ReturnType<typeof buildInvestigation>;
const show = (value: unknown) => value == null ? "Unknown" : String(value);
export function investigationMarkdown(bundle: Investigation): string {
  const run = bundle.analysis;
  const lines = ["# Rooted investigation report", "", `Schema: ${bundle.schema} v${bundle.schema_version}`, `Exported: ${show(bundle.exported_at)}`, "",
    "## Identity and scope", "", `- Report: ${run.id}`, `- Network / mode / chain: ${run.network} / ${run.mode} / ${run.chain_id}`,
    `- Execution block: ${run.block.number} (${run.block.hash})`, `- Analyzed: ${show(run.created_at)}`, `- Canonical at fetch: ${show(run.canonical_at_fetch)}`,
    `- Selection: ${bundle.selection.graph}; transaction index: ${bundle.selection.transaction_index == null ? "all" : bundle.selection.transaction_index}`,
    `- Native BAL commitment verified: ${show(run.native_bal?.commitment_verified)}`, `- Native commitment: ${show(run.native_bal?.computed_commitment)}`, "",
    "## Contention", "", `Denominator: ${bundle.selection.denominator} returned location-level conflict edges.`, "", "| Category | Edges | Share |", "| --- | ---: | ---: |"];
  for (const category of bundle.contention.categories) lines.push(`| ${category.label} | ${category.count} | ${category.share == null ? "Unknown" : (category.share * 100).toFixed(1) + "%"} |`);
  lines.push("", "## Coverage", "");
  const graph = bundle.selection.graph === "storage_projection" ? run.storage_projection : run.graph;
  lines.push(`- Full dependency coverage: ${show(graph.full_dependency_coverage)}`, `- Storage-read coverage complete: ${show(graph.storage_read_coverage_complete)}`, `- Graph truncated: ${show(graph.truncated)}`, ...[...graph.coverage, ...run.coverage].map(code => `- ${code}`));
  lines.push("", "## Findings", "", `Showing ${bundle.findings.length} of ${bundle.selection.denominator} selected edges; the JSON bundle includes both complete returned graphs.`);
  for (const finding of bundle.findings) lines.push("", `### ${finding.id}: ${finding.title}`, "", finding.explanation, "", `Exact location: ${finding.location.address} / ${finding.location.field} / ${show(finding.location.key)}`, `Transactions: ${finding.transaction_hashes.map(show).join(" → ")}`, ...finding.proof_notes.map(note => `- ${note}`), `Evidence references in JSON: ${finding.evidence_refs.join(", ")}`);
  lines.push("", "## Linked payload and policy evidence", "", `Payload search: ${bundle.linked_evidence.payload_status}; matched observations: ${bundle.linked_evidence.payloads.length}.`, `Policy search: ${bundle.linked_evidence.policy_status}; matched window checks: ${bundle.linked_evidence.policy_checks.length}.`, `Bounds: ${JSON.stringify(bundle.linked_evidence.search_bounds)}.`, "");
  for (const row of bundle.linked_evidence.payloads) lines.push(`- Slot ${show(row.slot)} / root ${show(row.block_root)} / payload ${show(row.payload_hash)}; reveal receipt difference: ${show(row.reveal_latency_ms)} ms; source reference: ${show(row.source_ref)}.`);
  for (const check of bundle.linked_evidence.policy_checks) lines.push(`- Policy report: ${JSON.stringify(check.report)}. ${check.relationship}`);
  lines.push("", "## Sources", "", ...run.sources.map(source => `- ${JSON.stringify(source)}`), "", "## Limitations and redactions", "", ...bundle.limitations.map(note => `- ${note}`), "", "## Versioned evidence bundle", "", "The complete versioned JSON evidence bundle is embedded below, so this report can be inspected without Rooted. JSON-pointer references above are relative to this object.", "", "```json", JSON.stringify(bundle, null, 2), "```", "");
  return lines.join("\n");
}
