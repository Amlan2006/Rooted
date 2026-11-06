"use client";
import { useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/data";
import { buildInvestigation, investigationMarkdown } from "@/lib/investigation-export";
import { collectInvestigationLinks } from "@/lib/investigation-links";
import { Panel } from "./ui";

export default function InvestigationDownload({ run, projection, focus, linkedSource }: { run: Run; projection: boolean; focus: number | null; linkedSource?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const downloadURL = useRef<string | null>(null);
  useEffect(() => () => { active.current?.abort(); if (downloadURL.current) URL.revokeObjectURL(downloadURL.current); }, []);
  async function download(format: "json" | "md") {
    if (busy) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage(""); setError("");
    try {
      const overallTimeout = AbortSignal.timeout(30000);
      const links = await collectInvestigationLinks(run, async path => {
        const response = await fetch("/api/backend" + path, { cache: "no-store", signal: AbortSignal.any([controller.signal, overallTimeout, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error("Optional evidence unavailable");
        return response.json();
      }, linkedSource || undefined);
      if (controller.signal.aborted) return;
      const bundle = buildInvestigation(run, projection, focus, links);
      const content = format === "json" ? JSON.stringify(bundle, null, 2) : investigationMarkdown(bundle);
      if (downloadURL.current) URL.revokeObjectURL(downloadURL.current);
      const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/markdown;charset=utf-8" }));
      downloadURL.current = url;
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `rooted-${run.mode}-${run.id.slice(2, 14)}-${projection ? "storage" : "all-state"}-${focus == null ? "all" : `tx${focus}`}.${format}`;
      anchor.click();
      setMessage(`Download prepared. Payload evidence: ${String(bundle.linked_evidence.payload_status).replaceAll("_", " ")}; policy evidence: ${String(bundle.linked_evidence.policy_status).replaceAll("_", " ")}.`);
    } catch {
      if (!controller.signal.aborted) setError("Unable to prepare this investigation report. Refresh the saved analysis and retry.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <Panel id="investigation-download" title="Download investigation" subtitle="A readable report or versioned evidence bundle for this saved analysis">
    <div className="investigation-download">
      <p>{run.network} · {run.mode} · {projection ? "Storage projection" : "All known state"} · {focus == null ? "All transactions" : `Transaction ${focus}`}. Exports preserve this selection and include both returned graphs.</p>
      <div className="button-row"><button className="primary" disabled={busy} onClick={() => void download("md")}>Download report (.md)</button><button disabled={busy} onClick={() => void download("json")}>Download JSON bundle</button></div>
      <p className="muted">The Markdown report embeds its complete JSON evidence. Optional payload and policy links are checked by immutable identity. Endpoints, operator source names, credentials, and raw responses are excluded. This download uses the ordinary backend connection.</p>
      {busy && <p role="status">Preparing report and checking optional linked evidence…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Panel>;
}
