import type { Run } from "./data";
export type LinkedEvidence = {
  source?: string;
  payloadStatus: "matched" | "not_found_in_search" | "unavailable" | "unsupported_scope";
  policyStatus: "matched" | "not_found_in_search" | "unavailable" | "unsupported_scope";
  payloads: Record<string, unknown>[];
  policies: { report: Record<string, unknown>; summary: Record<string, unknown> }[];
  search: { payloadLimit: number; policyLimit: number; summaryLimit: number; summariesChecked: number; summaryFailures: number };
};
export const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const records = (value: unknown) => Array.isArray(value) ? value.map(asRecord) : [];
const root = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

// Optional joins are bounded and must match immutable identities and exact scope.
// No raw RPC/HTTP bodies or credentials are requested for the export.
export async function collectInvestigationLinks(run: Run, read: (path: string) => Promise<unknown>, sourceOverride?: string): Promise<LinkedEvidence> {
  const result: LinkedEvidence = { payloadStatus: "unsupported_scope", policyStatus: "unsupported_scope", payloads: [], policies: [], search: { payloadLimit: 200, policyLimit: 100, summaryLimit: 10, summariesChecked: 0, summaryFailures: 0 } };
  if (run.network !== "sepolia" || run.mode !== "live") return result;
  result.payloadStatus = "unavailable"; result.policyStatus = "unavailable";
  let source: string;
  if (sourceOverride !== undefined) {
    if (!sourceOverride || sourceOverride.length > 100) return result;
    source = sourceOverride;
  } else {
    try {
      const collector = asRecord(await read("/api/v1/collector?network=sepolia"));
      if (collector.network !== run.network || typeof collector.source !== "string" || !collector.source || collector.source.length > 100) return result;
      source = collector.source;
    } catch { return result; }
  }
  result.source = source;
  const scope = new URLSearchParams({ network: run.network, mode: run.mode, source }).toString();
  let slot: string | null = null;
  if (run.block.slotNumber && /^0x[0-9a-f]+$/i.test(run.block.slotNumber)) slot = BigInt(run.block.slotNumber).toString();
  try {
    const response = asRecord(await read(`${slot ? `/api/v1/payloadwatch/slots/${slot}` : "/api/v1/slots"}?${scope}&limit=200`));
    if (response.network !== run.network || response.mode !== run.mode || response.source !== source) throw new Error("scope mismatch");
    result.payloads = records(response.data).filter(row => row.network === run.network && row.mode === run.mode && row.source_id === source &&
      root(row.block_root) && root(row.payload_hash) && row.payload_hash.toLowerCase() === run.block.hash.toLowerCase() &&
      (slot === null || row.slot === slot));
    result.payloadStatus = result.payloads.length ? "matched" : "not_found_in_search";
  } catch { /* Optional evidence stays explicitly unavailable. */ }
  try {
    const response = asRecord(await read(`/api/v1/cre/reports?${scope}&limit=100`));
    const responseScope = asRecord(response.scope);
    if (responseScope.network !== run.network || responseScope.mode !== run.mode || responseScope.source !== source) throw new Error("scope mismatch");
    const reports = records(response.data).filter(report => report.network === run.network && report.mode === run.mode && report.source === source && root(report.id) && root(report.summary_id));
    result.policyStatus = "not_found_in_search";
    const cache = new Map<string, Record<string, unknown> | null>();
    for (const report of reports) {
      const id = report.summary_id as string;
      if (!cache.has(id)) {
        if (cache.size >= result.search.summaryLimit) continue;
        result.search.summariesChecked++;
        try { cache.set(id, asRecord(asRecord(await read(`/api/v1/incidents/summaries/${id}?${scope}`)).data)); }
        catch { cache.set(id, null); result.search.summaryFailures++; }
      }
      const summary = cache.get(id);
      if (!summary || summary.id !== id || summary.network !== run.network || summary.mode !== run.mode || summary.source !== source || summary.monitored_chain_id !== run.chain_id) continue;
      const matches = (entry: Record<string, unknown>) => result.payloads.some(payload => entry.payload_hash === payload.payload_hash && entry.block_root === payload.block_root && entry.slot === payload.slot);
      const evidence = records(summary.evidence);
      const maximum = asRecord(summary.max_latency_evidence);
      if (evidence.some(matches) || matches(maximum)) result.policies.push({ report, summary });
    }
    if (result.policies.length) result.policyStatus = "matched";
    else if (result.search.summaryFailures) result.policyStatus = "unavailable";
  } catch { result.policyStatus = "unavailable"; }
  return result;
}
