"use client";
import { useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/data";
import { parseAnalysisRequest } from "@/lib/analysis-request";
import { Panel } from "./ui";

export default function AnalysisForm({ onComplete, transactionOnly = false }: { onComplete: (run: Run) => void; transactionOnly?: boolean }) {
  const [kind, setKind] = useState<"transaction" | "block">("transaction");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(""); setSuccess("");
    let input;
    try { input = parseAnalysisRequest({ kind, hash }); }
    catch (error) { setError((error as Error).message); return; }
    setBusy(true);
    const active = new AbortController(); controller.current = active;
    try {
      const response = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.any([active.signal, AbortSignal.timeout(100000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Analysis failed.");
      const run = body.data as Run;
      if (!run || run.network !== "sepolia" || run.mode !== "live" || !run.id || !run.block ||
          (input.kind === "block" ? run.block.hash.toLowerCase() !== input.hash : !run.analyzed_transactions?.some(tx => tx.transaction.hash.toLowerCase() === input.hash)))
        throw new Error("The returned report does not match your request.");
      onComplete(run);
      setSuccess(`Analysis complete. Showing block ${parseInt(run.block.number, 16).toLocaleString()}.`);
    } catch (error) {
      if (!active.signal.aborted) setError(error instanceof Error ? error.message : "Analysis failed. Please retry.");
    } finally { if (!active.signal.aborted) setBusy(false); }
  }
  return <Panel title={transactionOnly ? "Start with a Sepolia transaction" : "Analyze a Sepolia transaction or block"} subtitle="Paste a hash to fetch a native BAL and inspect shared state.">
    <form className="analysis-form" onSubmit={submit} aria-busy={busy}>
      <div className={"analysis-inputs" + (transactionOnly ? " transaction-only" : "")}>
        {!transactionOnly && <label>Analyze by
          <select value={kind} disabled={busy} onChange={event => { setKind(event.target.value as typeof kind); setHash(""); setError(""); setSuccess(""); }}>
            <option value="transaction">Transaction hash</option><option value="block">Block hash</option>
          </select>
        </label>}
        <label>{kind === "transaction" ? "Transaction hash" : "Block hash"}
          <input value={hash} disabled={busy} onChange={event => { setHash(event.target.value); setError(""); setSuccess(""); }} placeholder="0x…" autoComplete="off" spellCheck={false} required maxLength={66} aria-describedby="analysis-help" />
        </label>
        <button className="primary" disabled={busy} type="submit">{busy ? "Analyzing…" : "Analyze"}</button>
      </div>
      <p id="analysis-help">{kind === "transaction" ? "Finds the mined transaction’s block, verifies its BAL, and traces this transaction for calls and swap evidence." : "Verifies the block’s BAL and builds its dependency graph. Use a transaction hash for swap events and call traces."} Results are saved. Requests use the configured backend connection.</p>
      {busy && <p role="status">Fetching and verifying node evidence. This may take up to 90 seconds; the previous report remains below.</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {success && <div className="notice" role="status">{success}</div>}
    </form>
  </Panel>;
}
