import type { Run } from "./data";
import { asRecord } from "./investigation-links";
const root = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
export type InvestigationSelection = { report: string; network: string; mode: string; transaction: string | null; source: string | null };
export function parseInvestigationSelection(params: URLSearchParams): InvestigationSelection | null {
  if (!["report", "network", "mode", "transaction", "source"].some(key => params.has(key))) return null;
  const report = params.get("report"), network = params.get("network"), mode = params.get("mode"), transaction = params.get("transaction"), source = params.get("source");
  if (!root(report) || !["sepolia", "sepolia-fork"].includes(network || "") || !["live", "fork", "captured", "synthetic", "replay"].includes(mode || "") ||
      (network === "sepolia-fork") !== (mode === "fork") || (transaction !== null && !root(transaction)) || (source !== null && (!source || source.length > 100))) throw new Error("Invalid investigation link. Select a saved report with explicit network and mode.");
  return { report: report.toLowerCase(), network: network!, mode: mode!, transaction: transaction?.toLowerCase() || null, source };
}
export function selectionForRun(run: Run, transaction?: string | null): InvestigationSelection {
  const tx = transaction === undefined ? run.analyzed_transactions?.[0]?.transaction.hash ?? null : transaction;
  const params = new URLSearchParams({ report: run.id, network: run.network, mode: run.mode });
  if (tx) params.set("transaction", tx);
  const selection = parseInvestigationSelection(params)!;
  if (!matchesInvestigation(run, selection)) throw new Error("Transaction is not bound to the requested report.");
  return selection;
}
export function investigationURL(selection: InvestigationSelection) {
  const params = new URLSearchParams({ view: "investigate", report: selection.report, network: selection.network, mode: selection.mode });
  if (selection.transaction) params.set("transaction", selection.transaction);
  if (selection.source) params.set("source", selection.source);
  parseInvestigationSelection(params);
  return "?" + params;
}
export function reportPath(selection: InvestigationSelection) {
  investigationURL(selection);
  return `/api/v1/analysis/runs/${selection.report}?${new URLSearchParams({ network: selection.network, mode: selection.mode })}`;
}
export function matchesInvestigation(run: Run, selection: InvestigationSelection) {
  return run.id?.toLowerCase() === selection.report && run.network === selection.network && run.mode === selection.mode && run.chain_id === (selection.network === "sepolia-fork" ? "31337" : "11155111") && root(run.block?.hash) &&
    (selection.transaction === null || run.block.transactions.some(tx => tx.hash.toLowerCase() === selection.transaction));
}
export type PayloadTimeline = { status: "matched" | "not_found_in_page" | "unavailable"; events: Record<string, unknown>[]; limit: number };
export async function payloadTimeline(run: Run, payload: Record<string, unknown>, read: (path: string) => Promise<unknown>): Promise<PayloadTimeline> {
  const result: PayloadTimeline = { status: "unavailable", events: [], limit: 200 };
  if (payload.network !== run.network || payload.mode !== run.mode || typeof payload.source_id !== "string" || !payload.source_id || payload.source_id.length > 100 || typeof payload.slot !== "string" || !/^\d+$/.test(payload.slot) ||
      !root(payload.block_root) || !root(payload.payload_hash) || payload.payload_hash.toLowerCase() !== run.block.hash.toLowerCase()) return result;
  const scope = new URLSearchParams({ network: run.network, mode: run.mode, source: payload.source_id });
  try {
    const response = asRecord(await read(`/api/v1/payloadwatch/slots/${payload.slot}/timeline?${scope}&limit=200`));
    if (response.network !== run.network || response.mode !== run.mode || response.source !== payload.source_id) return result;
    result.events = (Array.isArray(response.data) ? response.data : []).map(asRecord).filter(row => {
      const event = asRecord(row.event);
      return event.network === run.network && event.mode === run.mode && event.source_id === payload.source_id && event.slot === payload.slot &&
        typeof event.block_root === "string" && event.block_root.toLowerCase() === String(payload.block_root).toLowerCase() &&
        (!event.payload_hash || String(event.payload_hash).toLowerCase() === run.block.hash.toLowerCase());
    });
    result.status = result.events.length ? "matched" : "not_found_in_page";
  } catch { /* Missing timing is never replaced with a polling timestamp. */ }
  return result;
}
