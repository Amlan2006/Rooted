export type AnalysisRequest = { kind: "transaction" | "block"; hash: string };
export function parseAnalysisRequest(value: unknown): AnalysisRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide an analysis request.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "kind" && key !== "hash") ||
      (input.kind !== "transaction" && input.kind !== "block") ||
      typeof input.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.hash.trim())) {
    throw new Error("Enter a complete 0x-prefixed transaction or block hash (64 hex characters).");
  }
  return { kind: input.kind, hash: input.hash.trim().toLowerCase() };
}
export function ingestionPath(input: AnalysisRequest): string {
  const checked = parseAnalysisRequest(input);
  return `/api/v1/analysis/${checked.kind === "transaction" ? "transactions" : "blocks"}/${checked.hash}/ingest?network=sepolia&mode=live`;
}
