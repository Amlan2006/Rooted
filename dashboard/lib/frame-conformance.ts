// rooted-frame-conformance-v1 (spec §4): expected verdicts per source vs the devnet node's observed verdict.
export const sources = ["eip8141", "eip8250", "erc8421_draft", "sidecar_docs"] as const;
export type Source = (typeof sources)[number];
export type ConformanceCase = {
  id: string; group: string; description: string; overrides: Record<string, unknown>;
  expected: Record<Source, "accept" | "reject" | "n/a">; expected_basis: Partial<Record<Source, string>>;
  tx_hash: string | null; submitted_at: string | null;
  rpc: { acknowledged: boolean; error_code: number | null; error_message: string | null } | null;
  admission: { outcome: string; failed_checks: { rule: string; detail: string; frameIndex: number | null; entity: string }[] } | null;
  observed: "accept" | "reject" | "unknown"; observed_rule: string | null; rooted_attempt_id: string | null;
  receipt: { block_number: string; status: string } | null;
  archive_status?: string | null; // Rooted archive lifecycle status for tx_hash in the results.node scope (or ?node=), added by the API
};
export type Conformance = {
  schema: "rooted-frame-conformance-v1"; run_id: string; network: string; chain_id: number; genesis: string; gateway: string; node?: string; node_url?: string; sidecar_version: string;
  started_at: string; finished_at: string; sender: string; sources: Partial<Record<Source, string>>; cases: ConformanceCase[];
};
export function parseConformance(v: unknown): Conformance {
  const r = (v && typeof v === "object" ? v : {}) as Conformance;
  if (r.schema !== "rooted-frame-conformance-v1" || !Array.isArray(r.cases)) throw Error("Unsupported frame conformance results.");
  for (const c of r.cases)
    if (typeof c?.id !== "string" || !c.expected || sources.some(s => !["accept", "reject", "n/a"].includes(c.expected[s])) || !["accept", "reject", "unknown"].includes(c.observed))
      throw Error("Invalid frame conformance case.");
  return r;
}
// null = nothing to compare (source says n/a, or the node gave no verdict).
export const matches = (c: ConformanceCase, s: Source) => (c.expected[s] === "n/a" || c.observed === "unknown" ? null : c.expected[s] === c.observed);
export function divergent(c: ConformanceCase) {
  const known = sources.map(s => c.expected[s]).filter(v => v !== "n/a");
  return new Set(known).size > 1 || sources.some(s => matches(c, s) === false);
}
export const explorerTx = (hash: string) => `https://explorer.altmempool.wtf/tx/${hash}`;
export type Submission = { attempt_id: string; expected_hash: string; submitted_at: string; submission_status: string };
// The journal wins. A fresh database has no journal, so fall back to the run's baseline case: the same script's own
// acknowledged submission, already archived by the API join. Never spends another devnet submission.
export function ownSubmission(journal: Submission[] | undefined, run: Conformance | null): (Submission & { fromRun?: string }) | undefined {
  const own = journal?.find(s => s.submission_status === "submission_acknowledged");
  const b = run?.cases.find(c => c.id === "baseline" && c.tx_hash && c.rpc?.acknowledged);
  if (own || !journal || !b?.tx_hash) return own;
  return { attempt_id: b.rooted_attempt_id ?? "", expected_hash: b.tx_hash, submitted_at: b.submitted_at ?? "", submission_status: "submission_acknowledged", fromRun: run!.run_id };
}
