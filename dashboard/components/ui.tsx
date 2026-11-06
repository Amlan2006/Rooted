"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Braces, ChevronDown, X } from "lucide-react";
import { age } from "@/lib/data";
import type { Resource } from "@/lib/hooks";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  id,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={"panel " + className}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Notice<T>({
  resource,
  empty,
}: {
  resource: Resource<T>;
  empty?: boolean;
}) {
  if (resource.loading)
    return (
      <div className="notice loading">
        Retrieving persisted observations<span className="dots">…</span>
      </div>
    );
  if (resource.error)
    return (
      <div className="notice error" role="alert">
        <AlertCircle size={17} />
        <span>
          {resource.error}
          {resource.data && " Showing the last successful response."}
        </span>
        <button onClick={resource.refresh}>Retry</button>
      </div>
    );
  if (empty)
    return (
      <div className="notice">
        No observations in this scope yet. Start its collector or ingest a
        block.
      </div>
    );
  return null;
}
export function Freshness({ at, error }: { at?: string; error?: string }) {
  const stale = !at || Date.now() - Date.parse(at) > 45000;
  return (
    <span className={"freshness " + (stale || error ? "stale" : "")}>
      <i />
      {error ? "Update failed" : stale ? "Stale response" : "Updated"} ·{" "}
      {age(at)}
    </span>
  );
}
function EvidenceDialog({
  value,
  label,
  onClose,
}: {
  value: unknown;
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="evidence-dialog"
      aria-label={label}
      onCancel={onClose}
    >
      <div className="dialog-heading">
        <h2>{label}</h2>
        <button onClick={onClose} aria-label="Close evidence">
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        Source data from the selected network and mode. Missing values remain
        unknown.
      </p>
      <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>
    </dialog>
  );
}
export function Evidence({
  value,
  label = "Inspect evidence",
}: {
  value: unknown;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-button" onClick={() => setOpen(true)}>
        {label}
        <Braces size={12} />
      </button>
      {open && (
        <EvidenceDialog
          value={value}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function Coverage({ items }: { items: string[] }) {
  return (
    <details className="coverage">
      <summary>
        Coverage & provenance <span>{items.length} notes</span>
        <ChevronDown size={13} />
      </summary>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item.replaceAll("_", " ")}</li>
        ))}
      </ul>
    </details>
  );
}
export function Stat({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: string;
}) {
  return (
    <div className={"stat " + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
